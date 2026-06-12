import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildApprovalActionRow, buildApprovalReminderEmbed } from "../render/embeds.js";
import { matchChannelByType } from "../routing/route.js";

export const APPROVAL_REMINDERS_KEY = "approval-reminders";

// A fresh approval already has its approval.created card; only start reminding
// once it has sat undecided for a while.
const REMIND_AFTER_MS = 60 * 60 * 1000;
// Re-post at most this often per approval so the channel isn't spammed.
const REMIND_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Re-surface pending approvals until they are decided.
 *
 * The approval.created card is a one-shot message that scrolls away in busy
 * channels (and historically could be lost entirely). This job treats the
 * Paperclip API — not plugin state — as the source of truth for what is
 * pending, and keeps re-posting actionable cards (with working buttons) on an
 * interval until the operator decides. Decided approvals are pruned from the
 * reminder state automatically.
 */
export async function runApprovalsReminder(
  ctx: PluginContext,
  companyId: string,
  client: Client,
  config: CompanyConfig,
  fleetConfig: DiscordFleetConfig,
  paperclip: PaperclipClient,
  now = new Date(),
): Promise<void> {
  let pending;
  try {
    pending = await paperclip.getPendingApprovals(companyId);
  } catch (err) {
    ctx.logger.warn("approvals-reminder: failed to list pending approvals", {
      companyId,
      error: String(err),
    });
    return;
  }

  const nowMs = now.getTime();
  const stateKey = { scopeKind: "company" as const, scopeId: companyId, stateKey: APPROVAL_REMINDERS_KEY };
  const reminders = ((await ctx.state.get(stateKey)) as Record<string, string> | null) ?? {};

  // Prune decided approvals so reminder state cannot grow unbounded.
  const pendingIds = new Set(pending.map((a) => a.id));
  for (const id of Object.keys(reminders)) {
    if (!pendingIds.has(id)) delete reminders[id];
  }

  for (const approval of pending) {
    const createdMs = Date.parse(approval.createdAt);
    if (!Number.isFinite(createdMs)) continue;
    const ageMs = nowMs - createdMs;
    if (ageMs < REMIND_AFTER_MS) continue;

    const lastReminded = reminders[approval.id] ? Date.parse(reminders[approval.id]) : null;
    if (lastReminded !== null && nowMs - lastReminded < REMIND_EVERY_MS) continue;

    const title = approval.payload?.title ?? undefined;
    const url = `${config.paperclipApiUrl}/${config.companyPrefix}/approvals/${approval.id}`;
    const ageHours = Math.floor(ageMs / 3_600_000);
    const destinationChannelId =
      matchChannelByType(fleetConfig.approvalsChannelsByType?.[companyId], [title]) ??
      config.approvalFallbackChannelId ??
      config.channels.orphan;

    const embed = buildApprovalReminderEmbed({
      approvalId: approval.id,
      approvalType: approval.type,
      title,
      issueUrl: url,
      ageHours,
      now,
    });
    const actionRow = buildApprovalActionRow({ approvalId: approval.id, issueUrl: url });

    try {
      const messageId = await postEmbedToChannel(client, destinationChannelId, embed, [actionRow]);
      reminders[approval.id] = now.toISOString();
      ctx.logger.info("approvals-reminder: re-posted pending approval", {
        approvalId: approval.id,
        destinationChannelId,
        messageId,
        ageHours,
      });
    } catch (err) {
      // Not marked reminded — the next run retries, which is the whole point.
      ctx.logger.warn("approvals-reminder: failed to post reminder", {
        approvalId: approval.id,
        destinationChannelId,
        error: String(err),
      });
    }
  }

  await ctx.state.set(stateKey, reminders);
}
