import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient } from "../api/paperclip.js";
import { postEmbedToChannel, postToChannel } from "../discord/rest.js";
import { buildApprovalActionRow, buildApprovalReminderEmbed } from "../render/embeds.js";
import { truncate } from "../render/plain.js";
import { stripSecrets } from "../render/secrets.js";
import { matchChannelByType } from "../routing/route.js";
import { getThreadForAncestors } from "../routing/thread-state.js";
import { resolveApprovalContent, PENDING_APPROVALS_KEY } from "../handlers/approval-created.js";
import { PaperclipApiError } from "../api/paperclip.js";
import { safeParseMs } from "../util/safe.js";

export const APPROVAL_REMINDERS_KEY = "approval-reminders";

// A fresh approval already has its approval.created card; only start reminding
// once it has sat undecided for a while.
const REMIND_AFTER_MS = 60 * 60 * 1000;
// Re-post at most this often per approval so the channel isn't spammed.
const REMIND_EVERY_MS = 6 * 60 * 60 * 1000;

const CONTENT_CHUNK_MAX = 1900;

function chunkBySection(text: string): string[] {
  const raw = text.split(/(?=^## )/m).filter((s) => s.trim());
  const chunks: string[] = [];
  for (const section of raw) {
    if (section.length <= CONTENT_CHUNK_MAX) {
      chunks.push(section);
    } else {
      let remaining = section;
      while (remaining.length > CONTENT_CHUNK_MAX) {
        const cut = remaining.lastIndexOf("\n\n", CONTENT_CHUNK_MAX);
        const end = cut > 0 ? cut : CONTENT_CHUNK_MAX;
        chunks.push(remaining.slice(0, end));
        remaining = remaining.slice(end).trimStart();
      }
      if (remaining) chunks.push(remaining);
    }
  }
  return chunks;
}

/**
 * Re-surface pending approvals until they are decided.
 *
 * The approval.created card is a one-shot message that scrolls away in busy
 * channels (and historically could be lost entirely). This job treats the
 * Paperclip API — not plugin state — as the source of truth for what is
 * pending, and keeps re-posting actionable cards (with working buttons) on an
 * interval until the operator decides. Decided approvals are pruned from the
 * reminder state automatically.
 *
 * CHANGE 2: If `fleetConfig.approvalExpiry` has rules for this company, any
 * pending approval whose title matches a rule's `titleRegex` and whose age
 * exceeds `maxAgeHours` is auto-rejected before the reminder is posted. Expired
 * approvals are NOT re-posted as reminders in the same sweep.
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

  // Auto-expiry rules for this company (CHANGE 2).
  const expiryRules = fleetConfig.approvalExpiry?.[companyId] ?? [];

  for (const approval of pending) {
    try {
    const createdMs = safeParseMs(approval.createdAt);
    if (createdMs === null) continue;
    // Clamp future createdAt (clock skew / bogus server value) to age 0: the
    // approval is treated as just-created — reminded after the normal window,
    // never permanently suppressed and never instantly expired.
    const ageMs = Math.max(0, nowMs - createdMs);
    const ageHours = Math.floor(ageMs / 3_600_000);
    const titleRaw = approval.payload?.title;
    const title = typeof titleRaw === "string" ? titleRaw : "";

    // CHANGE 2: check auto-expiry rules before posting a reminder.
    // Regexes are compiled+screened at config load (validateConfig). Bound the
    // tested input so even a pathological pattern cannot blow up backtracking
    // on an adversarially long title.
    const boundedTitle = title.slice(0, 512);
    const matchedExpiry = expiryRules.find((rule) => {
      try {
        return new RegExp(rule.titleRegex).test(boundedTitle);
      } catch {
        return false;
      }
    });
    if (matchedExpiry && ageHours >= matchedExpiry.maxAgeHours) {
      // FAIL-CLOSED TOCTOU GUARD: a human may have decided this approval
      // between the pending-list fetch and now. Re-check immediately before the
      // irreversible reject; if the re-fetch fails or shows anything but
      // "pending", DO NOT reject (auto-expiry must never override a human).
      let stillPending = false;
      try {
        const fresh = await paperclip.getApprovalById(approval.id);
        stillPending = fresh?.status === "pending";
        if (fresh && fresh.status !== "pending") {
          // Decided while we were sweeping — nothing to remind either.
          continue;
        }
      } catch (err) {
        ctx.logger.warn("approvals-reminder: pre-expiry re-fetch failed — skipping expiry this sweep (fail closed)", {
          approvalId: approval.id,
          error: String(err),
        });
      }
      let rejectSucceeded = false;
      if (stillPending) {
        const decisionNote = `expired — time-sensitive card aged out (auto-expiry after ${matchedExpiry.maxAgeHours}h)`;
        try {
          await paperclip.rejectApproval(approval.id, decisionNote);
          rejectSucceeded = true;
          ctx.logger.info("approvals-reminder: auto-expired approval", {
            approvalId: approval.id,
            ageHours,
            maxAgeHours: matchedExpiry.maxAgeHours,
            titleRegex: matchedExpiry.titleRegex,
          });
        } catch (err) {
          if (err instanceof PaperclipApiError && err.status === 409) {
            // Already decided (race lost to a human) — human decision stands;
            // nothing to remind.
            ctx.logger.info("approvals-reminder: expiry skipped — approval already decided (409)", { approvalId: approval.id });
            continue;
          }
          // 403 = not a board key; log clearly as instructed. Fall through so
          // the normal reminder is still posted and the card does not go
          // permanently silent.
          ctx.logger.warn("approvals-reminder: auto-expiry reject failed (403 = not a board key?)", {
            approvalId: approval.id,
            error: String(err),
          });
        }
      }
      if (rejectSucceeded) {
        // Keep the daily digest coherent: drop the expired approval from the
        // shared PENDING list the same way the button handler does on decide.
        try {
          const pendingKey = { scopeKind: "company" as const, scopeId: companyId, stateKey: PENDING_APPROVALS_KEY };
          const pendingList = ((await ctx.state.get(pendingKey)) as string[] | null) ?? [];
          await ctx.state.set(pendingKey, pendingList.filter((id) => id !== approval.id));
        } catch (err) {
          ctx.logger.warn("approvals-reminder: failed to prune expired approval from pending list", {
            approvalId: approval.id,
            error: String(err),
          });
        }
        // Expiry reject succeeded; do NOT post a reminder in this sweep.
        continue;
      }
    }

    if (ageMs < REMIND_AFTER_MS) continue;

    // safeParseMs: a corrupted stored timestamp becomes null ("never reminded")
    // instead of NaN silently bypassing the throttle and spamming every sweep.
    const lastReminded = safeParseMs(reminders[approval.id]);
    if (lastReminded !== null && nowMs - lastReminded < REMIND_EVERY_MS) continue;

    const url = `${config.paperclipApiUrl}/${config.companyPrefix}/approvals/${approval.id}`;
    // Mirror handleApprovalCreated's routing tiers: explicit type route, then
    // the linked issue's work thread (so reminders land where the original
    // card did), then the per-company fallback/orphan channel.
    let destinationChannelId = matchChannelByType(
      fleetConfig.approvalsChannelsByType?.[companyId],
      [title],
    );
    if (!destinationChannelId) {
      try {
        const issues = await paperclip.getApprovalIssues(approval.id);
        const thread = issues.length
          ? await getThreadForAncestors(ctx, companyId, issues.map((i) => i.id))
          : null;
        destinationChannelId = thread?.threadId ?? null;
      } catch (err) {
        ctx.logger.warn("approvals-reminder: work-thread lookup failed, using fallback channel", {
          approvalId: approval.id,
          error: String(err),
        });
      }
    }
    destinationChannelId ??= config.approvalFallbackChannelId ?? config.channels.orphan;

    const embed = buildApprovalReminderEmbed({
      approvalId: approval.id,
      approvalType: approval.type,
      title: title || undefined,
      issueUrl: url,
      ageHours,
      now,
    });
    const actionRow = buildApprovalActionRow({ approvalId: approval.id, issueUrl: url });

    try {
      const messageId = await postEmbedToChannel(client, destinationChannelId, embed, [actionRow]);
      reminders[approval.id] = now.toISOString();
      // Persist per-post (not only at the end of the loop): a crash mid-run
      // must not forget which approvals were already reminded, or the next run
      // re-posts every one of them.
      await ctx.state.set(stateKey, { ...reminders });
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
      continue;
    }

    // CHANGE 1 (reminder path): also post the reviewable content so old blank
    // cards become readable on the next reminder cycle.
    // approval.payload is typed as { title?: string } | null but runtime shape
    // is z.record(z.unknown()) — index as unknown to satisfy the string guard.
    const approvalPayloadUnknown = approval.payload as Record<string, unknown> | null | undefined;
    const reviewableContent = resolveApprovalContent({
      proposedComment: approvalPayloadUnknown?.proposedComment,
      details: approvalPayloadUnknown?.details,
      description: approvalPayloadUnknown?.description,
    });
    if (reviewableContent) {
      const chunks = chunkBySection(stripSecrets(reviewableContent));
      for (const chunk of chunks) {
        try {
          await postToChannel(client, destinationChannelId, truncate(chunk, CONTENT_CHUNK_MAX));
        } catch (err) {
          ctx.logger.warn("approvals-reminder: content chunk post failed", {
            approvalId: approval.id,
            destinationChannelId,
            error: String(err),
          });
        }
      }
    }
    } catch (err) {
      ctx.logger.warn("approvals-reminder: unexpected error processing approval; skipping", {
        approvalId: approval.id,
        error: String(err),
      });
    }
  }

  await ctx.state.set(stateKey, reminders);
}
