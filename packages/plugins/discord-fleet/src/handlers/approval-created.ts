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
import { matchChannelByExactKey, matchChannelByType } from "../routing/route.js";
import { renderIssueDocs, type IssueDocsBundle } from "../render/issue-docs.js";
import {
  parsePostsBatchPayload,
  chunkPostsBatchForDiscord,
  renderOverflowMessages,
  buildPartialDeliveryWarning,
} from "../render/posts-batch.js";
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
  // Structured posts-batch render contract (GH #501) — see ../render/posts-batch.js.
  postsBatch?: unknown;
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

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Composes the "guidance" header block: summary, recommendedAction, risks —
// the fields the web UI treats as first-class. Extracted from
// resolveApprovalContent (GH #501 codex P2) so the postsBatch structured
// render path can post this guidance ALONGSIDE the per-post embeds — those
// embeds only carry image/hook/platform-copy fields, so without this,
// summary/recommendedAction/risks would silently disappear from Discord for
// any approval that has BOTH postsBatch and guidance fields set. Returns ""
// when none of the three fields are present.
export function resolveApprovalGuidance(payload: {
  summary?: unknown;
  recommendedAction?: unknown;
  risks?: unknown;
  [key: string]: unknown;
}): string {
  const header: string[] = [];
  if (str(payload.summary)) header.push(str(payload.summary));
  if (str(payload.recommendedAction)) header.push(`**Recommended:** ${str(payload.recommendedAction)}`);
  const risks = Array.isArray(payload.risks) ? payload.risks.map(str).filter(Boolean) : [];
  if (risks.length) header.push(`**Risks:** ${risks.join("; ")}`);
  return header.join("\n");
}

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
  const header = resolveApprovalGuidance(payload);
  const body = str(payload.proposedComment) || str(payload.details) || str(payload.description) || str(payload.body) || "";
  // Render-everything backstop (live incident 2026-07-04: an agent shipped the
  // whole artifact in payload.note — a field NO allowlist reads — and the card
  // was blank while the content sat in paperclip). Any unknown payload key with
  // string/string[] content is appended, so an agent's field-name choice can
  // never blank the card again.
  // Two exclusion classes: content fields already rendered above, and event/
  // infrastructure fields (routing + identity — never card content).
  const KNOWN = new Set([
    "proposedComment", "details", "description", "summary", "recommendedAction",
    "risks", "title", "approvalId", "version", "nextActionOnApproval", "body",
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
  return [header, body, extras.join("\n")].filter(Boolean).join("\n\n");
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
  // Stable, skill-authored routing discriminator (the 2026-05-15 plan's
  // slot-8 design, wired here for the first time): payload.approvalType is a
  // copy-paste constant the card-creating skill emits (e.g.
  // "content_batch_approval") — never LLM prose, so it cannot
  // paraphrase-drift the way the title did on 2026-07-07 (card fell to the
  // fallback channel on a one-character case miss). Deliberately NOT
  // payload.type: that is the closed server enum ("request_board_approval")
  // shared by every content card — useless as a surface discriminator.
  // Title stays as the second candidate for cards that predate the constant.
  const routingKey = str(payload.approvalType);
  // Candidate-major, not route-major (codex P2): the discriminator is tried
  // against the WHOLE table before the title sees any route. Passing both
  // candidates in one call would let a broad legacy title row placed above a
  // literal ^…$ row steal the match — priority must not depend on config row
  // ordering, which is convention a future config edit can silently break.
  const matchedChannelId =
    matchChannelByExactKey(config.approvalsChannelsByType?.[companyId], routingKey) ??
    matchChannelByType(config.approvalsChannelsByType?.[companyId], [approvalTitle]);
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
  // The created EVENT is ALWAYS partial — the server puts only title +
  // proposedComment on it (routes/approvals.ts), so a non-empty proposedComment
  // used to suppress the full-approval fetch and silently drop summary/risks/
  // body/custom fields (codex). Fetch the stored approval whenever the client
  // is available and let its payload win; the event payload is just the hint
  // that arrives when the API is down.
  let effectiveContent = reviewableContent;
  // postsBatch (GH #501): a structured, machine-built render contract that
  // rides ALONGSIDE proposedComment — same shape-guard philosophy as
  // carouselBatch on request_confirmation interactions (see
  // ../render/posts-batch.ts). The approval.created EVENT payload is
  // partial (server only puts title + proposedComment on it), so postsBatch
  // is really only ever found on the FULL fetched approval below — checked
  // on both so a future server change that includes it on the event still
  // works without this handler needing an update.
  let postsBatch = parsePostsBatchPayload(payload.postsBatch);
  // postsBatchGuidance (codex P2): summary/recommendedAction/risks, resolved
  // the SAME way effectiveContent is — the postsBatch structured embeds only
  // carry per-post image/hook/platform fields, so without this, guidance set
  // alongside postsBatch would silently disappear from Discord.
  let postsBatchGuidance = resolveApprovalGuidance(payload);
  if (paperclip) {
    try {
      const fullApproval = await paperclip.getApprovalById(approvalId);
      if (fullApproval?.payload) {
        const full = resolveApprovalContent(fullApproval.payload);
        if (full) {
          effectiveContent = full;
          ctx.logger.info("approval-created: content resolved from the stored approval payload", { approvalId });
        }
        const fullGuidance = resolveApprovalGuidance(fullApproval.payload);
        if (fullGuidance) postsBatchGuidance = fullGuidance;
        if (!postsBatch) {
          postsBatch = parsePostsBatchPayload(fullApproval.payload.postsBatch);
        }
      }
    } catch (err) {
      ctx.logger.warn("approval-created: full-approval fetch failed; using event-payload content", {
        approvalId,
        error: String(err),
      });
    }
  }

  // ISSUE-DIGEST fallback — the agent-independent path (2026-07-04 design:
  // months of blank cards trace to composition duties assigned to agents, who
  // fill approval payloads inconsistently. The one record the runtime FORCES
  // to exist is the linked issue's comment trail — every issue-bound run must
  // post a comment (execution-policy.md, comment-required backstop). So when
  // the payload yields nothing, compose the card from the issue itself:
  // identifier/title/status + the latest comments + the always-correct deep
  // link. Deterministic code over runtime-guaranteed data; nothing for an
  // agent to forget.)
  if (!effectiveContent && paperclip) {
    try {
      const linked = await paperclip.getApprovalIssues(approvalId);
      const primary = linked[0];
      if (primary) {
        const comments = await paperclip.listIssueComments(primary.id);
        // The route returns comments NEWEST-FIRST by default (codex P2:
        // routes/issues.ts:6032-6035) — sort explicitly, take the newest 3,
        // display oldest→newest so the thread reads naturally.
        const latest = comments
          .filter((c) => typeof c.body === "string" && c.body.trim())
          .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
          .slice(-3);
        const issueUrl = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/issues/${primary.identifier}`;
        const parts = [
          `**${primary.identifier ?? primary.id} — ${primary.title ?? "linked issue"}** (${primary.status ?? "?"})`,
          ...latest.map((c) => truncate((c.body as string).trim(), 900)),
          `Full history: ${issueUrl}`,
        ];
        effectiveContent = parts.join("\n\n");
        ctx.logger.info("approval-created: content derived from linked-issue digest", {
          approvalId,
          issueId: primary.id,
          commentCount: latest.length,
        });
      }
    } catch (err) {
      ctx.logger.warn("approval-created: linked-issue digest failed; posting header-only card", {
        approvalId,
        error: String(err),
      });
    }
  }

  // postsBatch structured render (GH #501): one embed per post (image + hook
  // + per-platform copy) instead of the plaintext chunkBySection path below.
  // A contract miss (absent/malformed postsBatch) falls straight through to
  // the existing plaintext path — legacy cards (and any card whose editor
  // hasn't shipped postsBatch yet) render exactly as before.
  //
  // DELIVERY-COMPLETENESS (codex P2, round 6): a bare "did anything post"
  // boolean flipped true by the FIRST successful embed group hid every LATER
  // group's failure — for a >10-post weekly batch, chunkPostsBatchForDiscord
  // splits into multiple Discord messages, and a transient failure on group 2
  // used to leave the operator an approvable card showing only group 1 with
  // no indication anything was missing. Fixed by tracking PER-UNIT delivery
  // (deliveredSlugs/missingSlugs) instead of one scalar, so the invariant —
  // "the operator must never see an approvable card whose visible content is
  // a silent subset of the batch" — holds regardless of which specific
  // groups/overflow messages fail, not just the all-or-nothing case:
  //   - every group/overflow-send gets one retry (mirrors the existing
  //     content-chunk retry-once pattern below) so a transient hiccup
  //     self-heals within this same call;
  //   - any RESIDUAL failure (after retry) is always tracked by slug in
  //     missingSlugs, never just logged-and-dropped;
  //   - if missingSlugs is non-empty when the loop ends, an unsuppressable
  //     buildPartialDeliveryWarning message posts naming exactly what's
  //     missing + the deep link to the full record — independent of whatever
  //     else succeeded, so it can never be silently skipped by a later
  //     success or an earlier one;
  //   - deliveredSlugs.size > 0 is what the plaintext-fallback gate below
  //     checks (unchanged semantics from the old boolean for the TOTAL
  //     failure case: 0 delivered still falls through to full plaintext,
  //     which is correct — with nothing delivered there is no "missing
  //     range" narrower than the whole batch).
  const deliveredSlugs = new Set<string>();
  const missingSlugs: string[] = [];
  // postSendWithRetry: one retry after a short pause, mirroring the
  // plaintext-chunk retry pattern below — factored out so the embed-group and
  // overflow-message loops (below) don't each duplicate the try/retry/catch
  // shape a third and fourth time.
  const postSendWithRetry = async (send: () => Promise<unknown>, label: string, logFields: Record<string, unknown>): Promise<boolean> => {
    try {
      await send();
      return true;
    } catch (err) {
      ctx.logger.warn(`approval-created: ${label} post failed; retrying once`, { ...logFields, error: String(err) });
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await send();
        return true;
      } catch (err2) {
        ctx.logger.warn(`approval-created: ${label} post failed after retry`, { ...logFields, error: String(err2) });
        return false;
      }
    }
  };
  if (postsBatch) {
    // Guidance (summary/recommendedAction/risks) posts BEFORE the per-post
    // embeds — renderPostsBatchEmbeds only carries image/hook/platform-copy
    // fields, so this is the only place that approval-level guidance reaches
    // Discord for a structured card (codex P2). Posted regardless of whether
    // the embeds themselves succeed below — a transient embed-send failure
    // must not also swallow guidance that already sent successfully. Routed
    // through postSendWithRetry + missingSlugs like every other unit
    // (DELIVERY-COMPLETENESS, round 6): guidance is part of the card's
    // visible content too, so a residual guidance-post failure must surface
    // via the same unsuppressable warning, not vanish into a log line.
    if (postsBatchGuidance) {
      const ok = await postSendWithRetry(
        () => postToChannel(client, destinationChannelId, truncate(stripSecrets(postsBatchGuidance), CONTENT_CHUNK_MAX)),
        "postsBatch guidance",
        { approvalId, destinationChannelId },
      );
      if (!ok) missingSlugs.push("guidance (summary/recommendedAction/risks)");
    }
    const { groups, overflow } = chunkPostsBatchForDiscord(postsBatch);
    for (const group of groups) {
      const ok = await postSendWithRetry(
        () => postEmbedsToChannel(client, destinationChannelId, group.embeds),
        "postsBatch embed group",
        { approvalId, destinationChannelId, slugs: group.slugs },
      );
      if (ok) for (const slug of group.slugs) deliveredSlugs.add(slug);
      else missingSlugs.push(...group.slugs);
    }
    // Platform copy longer than Discord's 1024-char embed field limit (codex
    // P2) — the embed field already shows a truncated preview; post the FULL
    // text as a plaintext follow-up so nothing is silently cut with no trace.
    // renderOverflowMessages reserves header budget BEFORE chunking (codex
    // P2, round 2: chunking to the full message budget then prepending a
    // header could itself overflow and get silently cut by postToChannel's
    // own truncate) — every returned string already fits within
    // CONTENT_CHUNK_MAX including its header.
    for (const item of overflow) {
      const messages = renderOverflowMessages(item, CONTENT_CHUNK_MAX);
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const label = `postsBatch platform-copy overflow (${item.itemSlug}/${item.platformLabel} ${i + 1}/${messages.length})`;
        const ok = await postSendWithRetry(
          () => postToChannel(client, destinationChannelId, stripSecrets(message)),
          label,
          { approvalId, destinationChannelId, itemSlug: item.itemSlug, platformLabel: item.platformLabel },
        );
        if (!ok) missingSlugs.push(`${item.itemSlug} (${item.platformLabel} full text ${i + 1}/${messages.length})`);
      }
    }
    // Unsuppressable: posts on ANY residual failure, regardless of how many
    // groups/overflow messages succeeded around it. Never gated by
    // deliveredSlugs — a partial batch (some delivered, some missing) must
    // surface this exactly as loudly as an all-failed one.
    if (missingSlugs.length > 0) {
      try {
        await postToChannel(client, destinationChannelId, buildPartialDeliveryWarning(missingSlugs, url));
      } catch (err) {
        ctx.logger.error("approval-created: partial-delivery warning post failed — card may look complete but is missing content", {
          approvalId,
          destinationChannelId,
          missingSlugs,
          error: String(err),
        });
      }
    }
  }
  const postsBatchDelivered = deliveredSlugs.size > 0;
  if (!postsBatchDelivered && effectiveContent) {
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
