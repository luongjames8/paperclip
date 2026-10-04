import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig } from "../config/schema.js";
import type { PaperclipClient } from "../api/paperclip.js";
import { postToChannel } from "../discord/rest.js";
import { stripSecrets } from "../render/secrets.js";
import { truncate } from "../render/plain.js";
import CronParser from "cron-parser";
import { PENDING_APPROVALS_KEY, updatePendingApprovals } from "../handlers/approval-created.js";

const LAST_DIGEST_FIRE_KEY = "last-digest-fire";

// When last-fire is more than one cron interval ago (e.g. process was down for multiple days),
// we fire once for the most recent scheduled slot only — we do NOT replay missed days.
// Restarting after a multi-day outage emits one digest (for today), not N.
// Returns the scheduled slot Date if the digest should fire, null otherwise.
async function shouldFireDigest(
  ctx: PluginContext,
  company: CompanyConfig,
  now: Date,
): Promise<Date | null> {
  // Find the most recent scheduled fire time before now
  let lastScheduled: Date;
  try {
    const interval = CronParser.parseExpression(company.digest.cronExpression, {
      currentDate: now,
      tz: company.digest.timezone,
    });
    lastScheduled = interval.prev().toDate();
  } catch {
    return null; // invalid cron — skip
  }

  const lastFire = (await ctx.state.get({
    scopeKind: "company",
    scopeId: company.companyId,
    stateKey: LAST_DIGEST_FIRE_KEY,
  })) as string | null;

  if (!lastFire) {
    // Never fired; fire if lastScheduled is within the last 15 minutes (one job window)
    return now.getTime() - lastScheduled.getTime() <= 15 * 60 * 1000 ? lastScheduled : null;
  }

  return lastScheduled > new Date(lastFire) ? lastScheduled : null;
}

// Stamps the scheduled slot time — not wall-clock time — so comparisons remain correct
// regardless of when within the window the job actually ran.
async function markDigestFired(ctx: PluginContext, company: CompanyConfig, scheduledSlot: Date): Promise<void> {
  await ctx.state.set(
    { scopeKind: "company", scopeId: company.companyId, stateKey: LAST_DIGEST_FIRE_KEY },
    scheduledSlot.toISOString(),
  );
}

export async function runDigest(
  ctx: PluginContext,
  companyId: string,
  client: Client,
  config: CompanyConfig,
  paperclip: PaperclipClient,
  now = new Date(),
): Promise<void> {
  const scheduledSlot = await shouldFireDigest(ctx, config, now);
  if (!scheduledSlot) return;

  const [errors, pendingRaw] = await Promise.all([
    paperclip.getErrorsLast24h(companyId),
    ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }),
  ]);

  // Non-array state (corruption / old-version write) must not throw below.
  const pending = Array.isArray(pendingRaw)
    ? (pendingRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  if (errors.length === 0 && pending.length === 0) {
    await postToChannel(client, config.channels.digest, "✅ All clear — no blocked issues or pending approvals in the last 24h.");
    await markDigestFired(ctx, config, scheduledSlot);
    return;
  }

  const lines: string[] = ["📋 **Daily digest**"];
  if (pending.length > 0) {
    lines.push(`\n🟡 **Pending approvals** (${pending.length})`);
    for (const id of pending.slice(0, 10)) {
      lines.push(`  • ${id.slice(0, 8)}...`);
    }
    if (pending.length > 10) lines.push(`  … and ${pending.length - 10} more`);
  }
  if (errors.length > 0) {
    lines.push(`\n⛔ **Blocked issues** (${errors.length})`);
    for (const issue of errors.slice(0, 10)) {
      lines.push(`  • \`${issue.identifier}\` — ${issue.title.slice(0, 60)}`);
    }
    if (errors.length > 10) lines.push(`  … and ${errors.length - 10} more`);
  }

  await postToChannel(client, config.channels.digest, stripSecrets(truncate(lines.join("\n"))));

  // Clear the approvals this digest reported — only those, so an id added
  // while the digest was posting survives to the next one.
  const reported = new Set(pending);
  await updatePendingApprovals(ctx, companyId, (ids) => ids.filter((id) => !reported.has(id)));

  await markDigestFired(ctx, config, scheduledSlot);
}
