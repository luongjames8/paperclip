import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
  Client,
} from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { ChannelTypeRoute, DiscordFleetConfig } from "../config/schema.js";
import { postEmbedToChannel, postEmbedsToChannel, postToChannel } from "../discord/rest.js";
import { buildApprovalActionRow, buildApprovalEmbed } from "../render/embeds.js";
import { truncate } from "../render/plain.js";
import { stripSecrets } from "../render/secrets.js";
import { getThreadForAncestors } from "../routing/thread-state.js";
import { matchChannelByType } from "../routing/route.js";
import { renderIssueDocs, type IssueDocsBundle } from "../render/issue-docs.js";
import { PaperclipClient } from "../api/paperclip.js";
import { postDeliveryFailureFallback } from "./delivery-fallback.js";

interface ApprovalCreatedPayload {
  // Open-keyed: agents free-type payload field names (live 2026-07-04:
  // the artifact arrived in payload.note) — the renderer must see them all.
  [key: string]: unknown;
  approvalId?: unknown;
  // Canonical type field — set by server/src/routes/approvals.ts:118 as
  // `details: { type: approval.type }`, spread into payload by activity-log.
  type?: unknown;
  // Legacy field name kept as fallback for older emitters / unit tests.
  approvalType?: unknown;
  // Paperclip's `POST /companies/:id/approvals` activity emit carries
  // `issueIds: string[]` (server/src/routes/approvals.ts:118). The singular
  // `issueId` is kept for legacy/test compatibility but should not be the
  // primary lookup key.
  issueId?: unknown;
  issueIds?: unknown;
  identifier?: unknown;
  projectId?: unknown;
  title?: unknown;
  summary?: unknown;
  proposedComment?: unknown;
  details?: unknown;
  description?: unknown;
}

// PENDING is a shared list wiped daily by jobs/digest.ts (pre-existing
// mechanism, kept as-is). Card dedup uses TWO-PHASE PER-APPROVAL MARKERS
// instead of a shared array:
//   posting:<id> — in-flight marker written BEFORE the send, with a timestamp.
//                  A concurrent duplicate delivery sees it fresh and skips; a
//                  crashed sender leaves it to go stale (POSTING_STALE_MS) so
//                  the card stays retryable.
//   posted:<id>  — durable marker written only AFTER Discord confirms the send.
// Per-approval keys eliminate the shared-array races entirely: no read-modify-
// write on a common value, no stale-snapshot rollback that could strip other
// approvals' dedup, no single unbounded array that can outgrow a state-value
// limit and reset dedup for everything at once.
export const PENDING_APPROVALS_KEY = "pending-approvals";
export const POSTED_MARKER_PREFIX = "approval-posted:";
export const POSTING_MARKER_PREFIX = "approval-posting:";
export const POSTING_STALE_MS = 2 * 60 * 1000;
const CONTENT_CHUNK_MAX = 1900;

// Resolve the reviewable content string from an approval payload.
// Composes the operator-facing card text. Header block: summary,
// recommendedAction, risks — the fields the web UI treats as first-class but
// which previously never reached Discord at all (live incident 2026-07-03:
// operator saw a title-only card). Body: first non-empty STRING of
// proposedComment, details, description. Non-string values (object, number,
// null) are silently ignored so a malformed card cannot throw during an
// approvals-reminder sweep. Returns empty string when nothing is present.
export function resolveApprovalContent(payload: {
  proposedComment?: unknown;
  details?: unknown;
  description?: unknown;
  summary?: unknown;
  recommendedAction?: unknown;
  risks?: unknown;
  [key: string]: unknown;
}): string {
  const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const header: string[] = [];
  if (s(payload.summary)) header.push(s(payload.summary));
  if (s(payload.recommendedAction)) header.push(`**Recommended:** ${s(payload.recommendedAction)}`);
  const risks = Array.isArray(payload.risks) ? payload.risks.map(s).filter(Boolean) : [];
  if (risks.length) header.push(`**Risks:** ${risks.join("; ")}`);
  const body = s(payload.proposedComment) || s(payload.details) || s(payload.description) || "";
  // Render-everything backstop (live incident 2026-07-04: an agent shipped the
  // whole artifact in payload.note — a field NO allowlist reads — and the card
  // was blank while the content sat in paperclip). Any unknown payload key with
  // string/string[] content is appended, so an agent's field-name choice can
  // never blank the card again.
  // Two exclusion classes: content fields already rendered above, and event/
  // infrastructure fields (routing + identity — never card content).
  const KNOWN = new Set([
    "proposedComment", "details", "description", "summary", "recommendedAction",
    "risks", "title", "approvalId", "version", "nextActionOnApproval",
    "type", "approvalType", "issueIds", "issueId", "requestedByAgentId",
    "status", "companyId", "entityId", "kind", "id", "createdAt", "updatedAt",
    "identifier", "projectId",
  ]);
  const extras: string[] = [];
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (KNOWN.has(k)) continue;
    if (typeof v === "string" && v.trim()) extras.push(`**${k}:** ${v.trim()}`);
    else if (Array.isArray(v)) {
      const items = v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()));
      if (items.length) extras.push(`**${k}:** ${items.join("; ")}`);
    }
  }
  return [header.join("\n"), body, extras.join("\n")].filter(Boolean).join("\n\n");
}

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

export async function handleApprovalCreated(
  ctx: PluginContext,
  event: PluginEvent,
  client: Client,
  config: DiscordFleetConfig,
): Promise<void> {
  const companyId = event.companyId;
  const payload = event.payload as ApprovalCreatedPayload;
  // str(): safely extract a non-empty string from an unknown payload field.
  const str = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");
  const issueIdsRaw = Array.isArray(payload.issueIds)
    ? (payload.issueIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const issueIdRaw = str(payload.issueId);
  const candidateIssueIds = issueIdsRaw.length > 0 ? issueIdsRaw : issueIdRaw ? [issueIdRaw] : [];
  const primaryIssueId = candidateIssueIds[0] ?? "";
  const approvalId = str(payload.approvalId) || (event.entityId ?? "");
  const identifier = str(payload.identifier) || (primaryIssueId || approvalId).slice(0, 8);
  const approvalType = str(payload.type) || str(payload.approvalType) || "unknown";
  const approvalTitle = str(payload.title) || `Approval ${approvalId.slice(0, 8)}`;
  const reviewableContent = resolveApprovalContent(payload);

  ctx.logger.info("approval-created: handling", { companyId, approvalId, approvalType, entityId: event.entityId });

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) {
    ctx.logger.error("approval-created: no companyConfig for companyId — event delivered but this plugin instance has no config for this company", {
      companyId,
      approvalId,
    });
    return;
  }

  // Fail closed on a missing id: without it the marker keys would collapse to
  // the bare prefix and every malformed event would dedup against the first.
  if (!approvalId) {
    ctx.logger.error("approval-created: missing approvalId — cannot dedup; dropping event", {
      entityId: event.entityId,
      companyId,
    });
    return;
  }

  // Two-phase idempotency guard (duplicate event delivery observed live
  // 2026-07-02: two approval.created events 500 ms apart → duplicate cards).
  const postedKey = { scopeKind: "company" as const, scopeId: companyId, stateKey: `${POSTED_MARKER_PREFIX}${approvalId}` };
  const postingKey = { scopeKind: "company" as const, scopeId: companyId, stateKey: `${POSTING_MARKER_PREFIX}${approvalId}` };
  if (await ctx.state.get(postedKey)) {
    ctx.logger.info("approval-created: already posted, skipping", { approvalId, companyId });
    return;
  }
  const inFlightRaw = await ctx.state.get(postingKey);
  const inFlightMs = typeof inFlightRaw === "number" && Number.isFinite(inFlightRaw) ? inFlightRaw : null;
  const nowMs = Date.now();
  if (inFlightMs !== null && nowMs - inFlightMs < POSTING_STALE_MS) {
    // A concurrent duplicate delivery is mid-send. Skip — if IT fails, its
    // marker goes stale within POSTING_STALE_MS and the reminder sweep (or the
    // next duplicate delivery) retries. Failed sends are never suppressed
    // durably, and successful sends are never doubled by the observed race.
    ctx.logger.info("approval-created: concurrent post in flight, skipping", { approvalId, companyId });
    return;
  }
  // Ownership token: the state API has no compare-and-swap, so two deliveries
  // racing between the get and set could both think they own the send. Write a
  // unique token, wait a beat, and re-read — if another invocation overwrote it,
  // IT owns the send and we abort. This closes the read-write race to the width
  // of a single state write instead of the whole guard-to-send span.
  const ownershipToken = nowMs + Math.random();
  await ctx.state.set(postingKey, ownershipToken);
  await new Promise((r) => setTimeout(r, 150));
  const confirmed = await ctx.state.get(postingKey);
  if (confirmed !== ownershipToken) {
    ctx.logger.info("approval-created: lost posting-ownership race to a concurrent delivery, skipping", { approvalId, companyId });
    return;
  }

  const url = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/approvals/${approvalId}`;
  const embed = buildApprovalEmbed({ identifier, approvalId, approvalType, title: approvalTitle, issueUrl: url });
  const actionRow = buildApprovalActionRow({ approvalId, issueUrl: url });

  // Routing precedence:
  //   1. approvalsChannelsByType regex match on approval title (operator's
  //      explicit content-surface routing — highest priority).
  //   2. Existing work-thread/destination from parent issue (co-locates
  //      the approval with the work that produced it).
  //   3. companyConfig.approvalFallbackChannelId (per-company system-dump
  //      approvals channel — must be company-scoped to avoid cross-company
  //      leakage in multi-company deployments).
  //   4. companyConfig.channels.orphan (backward-compat default when
  //      approvalFallbackChannelId is absent).
  const matchedChannelId = matchChannelByType(
    config.approvalsChannelsByType?.[companyId],
    [approvalTitle],
  );
  let destinationChannelId: string;
  if (matchedChannelId) {
    destinationChannelId = matchedChannelId;
  } else {
    const existingThread = candidateIssueIds.length
      ? await getThreadForAncestors(ctx, companyId, candidateIssueIds)
      : null;
    destinationChannelId =
      existingThread?.threadId ??
      companyConfig.approvalFallbackChannelId ??
      companyConfig.channels.orphan;
  }

  let headerMessageId: string;
  try {
    headerMessageId = await postEmbedToChannel(client, destinationChannelId, embed, [actionRow]);
  } catch (err) {
    ctx.logger.error("approval-created: header card post failed", {
      approvalId,
      companyId,
      destinationChannelId,
      error: String(err),
    });
    // Clear the in-flight marker so a retried/duplicate delivery can post the
    // card immediately; even if this clear fails, the marker goes stale in
    // POSTING_STALE_MS. Failed sends are retryable BY CONSTRUCTION — there is
    // no durable "posted" record until Discord confirms the send below.
    try {
      await ctx.state.set(postingKey, 0);
    } catch {
      // stale-marker expiry is the backstop
    }
    // A channel-level failure (bad/deleted destinationChannelId, missing
    // channel-level permission override, archived thread, etc.) while the bot
    // IS a guild member would otherwise terminate here with only a plugin-log
    // entry — no approval comment, so an operator watching Paperclip (not
    // plugin logs) sees nothing. Fire the same durable-trace fallback
    // worker.ts's no-connected-client branch uses so this failure mode is
    // never silent either.
    await postDeliveryFailureFallback(
      ctx,
      config,
      event,
      `header card post to Discord channel ${destinationChannelId} failed: ${String(err)}`,
    );
    throw err;
  }
  // Durable marker ONLY after Discord confirmed the send (post-then-mark).
  // Deliberate tradeoff: the marker covers the HEADER card. If content chunks
  // below fail even after their retry, the card is header-only until the
  // reminder sweep re-carries the content — at-least-once content delivery,
  // never a duplicate header card.
  await ctx.state.set(postedKey, new Date(nowMs).toISOString());
  // Success is logged explicitly so an absent card in Discord can always be
  // distinguished from a posted-then-buried card during incident triage.
  ctx.logger.info("approval-created: card posted", { approvalId, destinationChannelId, headerMessageId });

  // Resolve API key + client once; reused for content fallback fetch and issue docs below.
  let paperclip: InstanceType<typeof PaperclipClient> | null = null;
  let apiKey: string | null = null;
  try {
    apiKey = await ctx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
    paperclip = new PaperclipClient(ctx, companyConfig.paperclipApiUrl, apiKey);
  } catch (err) {
    ctx.logger.warn("approval-created: failed to resolve API key; content fetch + issue docs unavailable", {
      approvalId,
      error: String(err),
    });
  }

  // ALWAYS post reviewable content immediately after the header so the operator
  // sees what they're being asked to approve without having to open Paperclip.
  // Use the first non-empty string of: proposedComment, details, description.
  // The approval.created event payload only carries title + proposedComment
  // (server/src/routes/approvals.ts:134-150). If the approval content lives in
  // payload.details or payload.description, resolveApprovalContent returns empty
  // here — fetch the full approval to get the complete payload before posting.
  let effectiveContent = reviewableContent;
  if (!effectiveContent && paperclip) {
    try {
      const fullApproval = await paperclip.getApprovalById(approvalId);
      if (fullApproval?.payload) {
        effectiveContent = resolveApprovalContent(fullApproval.payload);
        if (effectiveContent) {
          ctx.logger.info("approval-created: resolved content via full-approval fetch", { approvalId });
        }
      }
    } catch (err) {
      ctx.logger.warn("approval-created: full-approval fetch failed; posting header-only card", {
        approvalId,
        error: String(err),
      });
    }
  }

  if (effectiveContent) {
    const chunks = chunkBySection(stripSecrets(effectiveContent));
    for (const chunk of chunks) {
      try {
        await postToChannel(client, destinationChannelId, truncate(chunk, CONTENT_CHUNK_MAX));
      } catch (err) {
        // One retry after a short pause — a transient Discord hiccup shouldn't
        // leave the operator a header-only card until the next reminder cycle.
        ctx.logger.warn("approval-created: content chunk post failed; retrying once", {
          approvalId,
          destinationChannelId,
          error: String(err),
        });
        await new Promise((r) => setTimeout(r, 1500));
        try {
          await postToChannel(client, destinationChannelId, truncate(chunk, CONTENT_CHUNK_MAX));
        } catch (err2) {
          ctx.logger.error("approval-created: content chunk post failed after retry — card is header-only until a reminder re-post", {
            approvalId,
            destinationChannelId,
            error: String(err2),
          });
        }
      }
    }
  }

  // Linked-issue docs (rich embeds from posts/slides documents) are posted as
  // ADDITIONAL context after the reviewable content. They are independent — a
  // failure here does not affect the content already posted above.
  let bundle: IssueDocsBundle = { issues: [] };
  try {
    if (!paperclip) throw new Error("API client unavailable");
    const issues = await paperclip.getApprovalIssues(approvalId);
    // Promise.allSettled (not Promise.all) — one flaky listIssueDocuments call
    // shouldn't wipe successfully-fetched docs from the other linked issues.
    const settled = await Promise.allSettled(
      issues.map((i) => paperclip!.listIssueDocuments(i.id)),
    );
    const withDocs = settled.flatMap((res, idx) => {
      if (res.status === "fulfilled") {
        return [{ issueId: issues[idx].id, identifier: issues[idx].identifier, documents: res.value }];
      }
      ctx.logger.warn("approval-created: listIssueDocuments failed for one issue, skipping it", {
        approvalId,
        issueId: issues[idx].id,
        error: String(res.reason),
      });
      return [];
    });
    bundle = { issues: withDocs };
  } catch (err) {
    ctx.logger.warn("approval-created: failed to fetch issue docs", {
      approvalId,
      error: String(err),
    });
  }

  const groups = renderIssueDocs(bundle, approvalId.slice(0, 8));
  for (const group of groups) {
    try {
      await postEmbedsToChannel(client, destinationChannelId, group);
    } catch (err) {
      ctx.logger.warn("approval-created: rich-group post failed", {
        destinationChannelId,
        error: String(err),
      });
    }
  }

  const pendingRaw = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: PENDING_APPROVALS_KEY,
  });
  // Non-array state (corruption / old-version write) must not throw on push.
  const pending = Array.isArray(pendingRaw)
    ? (pendingRaw as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  pending.push(approvalId);
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }, pending);
}
