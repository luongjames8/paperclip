import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";

// Durable per-approval dedup marker so a persistently-failing delivery (bot
// never in the guild, permanently-wrong destinationChannelId, ongoing Discord
// outage) posts exactly ONE warning comment instead of a new one on every
// retry — approval-created.ts's header-card catch is explicitly retryable BY
// CONSTRUCTION (the posting marker is cleared so a retried/duplicate event
// can retry the send), and the approvals-reminder sweep re-invokes this on
// every tick, so without a marker here both paths would append a fresh
// comment each time they re-run. Mirrors POSTED_MARKER_PREFIX /
// POSTING_MARKER_PREFIX in approval-created.ts (one durable trace, not a
// cooldown-rate-limited stream of them).
const FALLBACK_POSTED_MARKER_PREFIX = "delivery-fallback-posted:";

// Best-effort last resort when an approval can't be delivered to Discord at
// all — either no connected client for the company (bot not in guild, or
// connect failed), or a channel-level post failure (bad/deleted
// destinationChannelId, missing channel-level permission override, archived
// thread, etc.) even though the bot IS a guild member: post a comment on the
// approval via the Paperclip API so non-delivery is visible to the operator
// in Paperclip even if nobody is reading plugin logs. Failure here is logged
// explicitly with its own message so a broken fallback path can't silently
// mask the original delivery failure the way the bare `if (!client) return;`
// used to. Extracted to its own module (rather than living in worker.ts) so
// approval-created.ts can call it too without a worker.ts <-> handlers
// circular import.
export async function postDeliveryFailureFallback(
  ctx: PluginContext,
  config: DiscordFleetConfig,
  event: PluginEvent,
  reason: string,
): Promise<void> {
  const companyConfig = config.companies.find((c) => c.companyId === event.companyId);
  const approvalId = (event.payload as { approvalId?: unknown })?.approvalId ?? event.entityId;
  if (!companyConfig || typeof approvalId !== "string" || !approvalId) return;
  const postedKey = {
    scopeKind: "company" as const,
    scopeId: event.companyId,
    stateKey: `${FALLBACK_POSTED_MARKER_PREFIX}${approvalId}`,
  };
  try {
    if (await ctx.state.get(postedKey)) {
      ctx.logger.info("discord-fleet: fallback comment already posted for this approval, skipping duplicate", {
        approvalId,
        companyId: event.companyId,
      });
      return;
    }
  } catch (err) {
    // A dedup-check failure must not block the fallback trace itself — fall
    // through and attempt the post (worst case: an extra comment, never a
    // missing one).
    ctx.logger.warn("discord-fleet: fallback dedup check failed, posting anyway", {
      approvalId,
      companyId: event.companyId,
      error: String(err),
    });
  }
  try {
    const apiKey = await ctx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
    const paperclip = new PaperclipClient(ctx, companyConfig.paperclipApiUrl, apiKey);
    await paperclip.addApprovalComment(
      approvalId,
      `⚠️ discord-fleet could not deliver this approval to Discord: ${reason}. Check plugin logs / bot guild membership.`,
    );
    await ctx.state.set(postedKey, new Date().toISOString());
  } catch (err) {
    ctx.logger.error("discord-fleet: fallback comment post also failed — non-delivery is now doubly silent", {
      approvalId,
      companyId: event.companyId,
      error: String(err),
    });
  }
}

// Same last-resort trace as postDeliveryFailureFallback, but for
// issue.execution_stage.pending (codex P2, fleet issue #631 round 9): unlike
// approvals, the SAME issue can cycle through this pending state repeatedly
// (review then approval; a changes-requested-then-resubmit loop can even
// re-pend the SAME stage), so a durable marker keyed only by issueId would
// permanently suppress every later occurrence after the first undelivered
// one. Keyed by stageId + the decision-generation token instead — the same
// token that already distinguishes pending "instances" on the Discord card
// itself (execution-stage-pending.ts / issue-execution-policy.ts), so each
// genuinely new pending instance gets its own fallback trace exactly once.
export async function postExecutionStageDeliveryFailureFallback(
  ctx: PluginContext,
  config: DiscordFleetConfig,
  event: PluginEvent,
  reason: string,
): Promise<void> {
  const companyConfig = config.companies.find((c) => c.companyId === event.companyId);
  const payload = event.payload as {
    issueId?: unknown;
    identifier?: unknown;
    stageId?: unknown;
    lastDecisionId?: unknown;
  };
  const issueId = typeof payload?.issueId === "string" ? payload.issueId : event.entityId;
  const stageId = payload?.stageId;
  if (!companyConfig || typeof issueId !== "string" || !issueId || typeof stageId !== "string" || !stageId) return;
  const decisionToken = typeof payload?.lastDecisionId === "string" ? payload.lastDecisionId.slice(0, 8) : "none";
  const postedKey = {
    scopeKind: "company" as const,
    scopeId: event.companyId,
    stateKey: `${FALLBACK_POSTED_MARKER_PREFIX}stage:${issueId}:${stageId}:${decisionToken}`,
  };
  try {
    if (await ctx.state.get(postedKey)) {
      ctx.logger.info("discord-fleet: execution-stage fallback comment already posted for this pending instance, skipping duplicate", {
        issueId,
        stageId,
        companyId: event.companyId,
      });
      return;
    }
  } catch (err) {
    ctx.logger.warn("discord-fleet: execution-stage fallback dedup check failed, posting anyway", {
      issueId,
      stageId,
      companyId: event.companyId,
      error: String(err),
    });
  }
  try {
    const apiKey = await ctx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
    const paperclip = new PaperclipClient(ctx, companyConfig.paperclipApiUrl, apiKey);
    await paperclip.addIssueComment(
      issueId,
      `⚠️ discord-fleet could not deliver this review/approval stage card to Discord: ${reason}. Check plugin logs / bot guild membership — decide directly in Paperclip in the meantime.`,
    );
    await ctx.state.set(postedKey, new Date().toISOString());
  } catch (err) {
    ctx.logger.error("discord-fleet: execution-stage fallback comment post also failed — non-delivery is now doubly silent", {
      issueId,
      stageId,
      companyId: event.companyId,
      error: String(err),
    });
  }
}
