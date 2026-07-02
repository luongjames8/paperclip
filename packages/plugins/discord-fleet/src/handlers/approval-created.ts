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

interface ApprovalCreatedPayload {
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

// Two state keys store the same approvalId list but have different lifetimes —
// don't collapse them into one. PENDING is wiped daily by jobs/digest.ts when
// the digest runs; SEEN never clears and is the authoritative dedup record for
// approval.created handling. Both writes happen at the end of a successful
// handler invocation.
export const PENDING_APPROVALS_KEY = "pending-approvals";
export const SEEN_APPROVALS_KEY = "seen-approvals";
const CONTENT_CHUNK_MAX = 1900;

// Resolve the reviewable content string from an approval payload.
// Returns the first non-empty STRING of: proposedComment, details, description.
// Non-string values (object, number, null) are silently ignored so a malformed
// card cannot throw during an approvals-reminder sweep.
// Returns empty string when none are present.
export function resolveApprovalContent(payload: {
  proposedComment?: unknown;
  details?: unknown;
  description?: unknown;
}): string {
  const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return s(payload.proposedComment) || s(payload.details) || s(payload.description) || "";
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

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  const seenKey = { scopeKind: "company" as const, scopeId: companyId, stateKey: SEEN_APPROVALS_KEY };
  const seenArr = ((await ctx.state.get(seenKey)) as string[] | null) ?? [];
  const seen = new Set(seenArr);
  if (seen.has(approvalId)) {
    ctx.logger.info("approval-created: already posted, skipping", { approvalId });
    return;
  }

  // Write the "posted" marker BEFORE the Discord send so a second concurrent
  // invocation (duplicate event delivery — observed live 2026-07-02, two events
  // 500 ms apart, same approvalId, different headerMessageIds) loses the
  // read-check-write race and exits at the guard above rather than double-posting.
  //
  // Residual: the state API has no atomic compare-and-swap primitive, so two
  // invocations that both pass the `seen.has()` check before EITHER write
  // (sub-millisecond race on a very cold state store) could still both post.
  // That window is orders of magnitude smaller than the 500 ms observed in the
  // live incident (cold-start vs. steady-state scheduling jitter) and is
  // acceptable without a distributed lock.
  seen.add(approvalId);
  await ctx.state.set(seenKey, [...seen]);

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

  const headerMessageId = await postEmbedToChannel(client, destinationChannelId, embed, [actionRow]);
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
        ctx.logger.warn("approval-created: content chunk post failed", {
          approvalId,
          destinationChannelId,
          error: String(err),
        });
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

  const pending = ((await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: PENDING_APPROVALS_KEY,
  })) as string[] | null) ?? [];
  pending.push(approvalId);
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }, pending);
}
