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
import { renderIssueDocs, type IssueDocsBundle } from "../render/issue-docs.js";
import { PaperclipClient } from "../api/paperclip.js";

interface ApprovalCreatedPayload {
  approvalId?: string;
  // Canonical type field — set by server/src/routes/approvals.ts:118 as
  // `details: { type: approval.type }`, spread into payload by activity-log.
  type?: string;
  // Legacy field name kept as fallback for older emitters / unit tests.
  approvalType?: string;
  // Paperclip's `POST /companies/:id/approvals` activity emit carries
  // `issueIds: string[]` (server/src/routes/approvals.ts:118). The singular
  // `issueId` is kept for legacy/test compatibility but should not be the
  // primary lookup key.
  issueId?: string;
  issueIds?: string[];
  identifier?: string;
  projectId?: string;
  title?: string;
  summary?: string;
  proposedComment?: string;
}

// Two state keys store the same approvalId list but have different lifetimes —
// don't collapse them into one. PENDING is wiped daily by jobs/digest.ts when
// the digest runs; SEEN never clears and is the authoritative dedup record for
// approval.created handling. Both writes happen at the end of a successful
// handler invocation.
export const PENDING_APPROVALS_KEY = "pending-approvals";
export const SEEN_APPROVALS_KEY = "seen-approvals";
const THREAD_CHUNK_MAX = 1990;

function chunkBySection(text: string): string[] {
  const raw = text.split(/(?=^## )/m).filter((s) => s.trim());
  const chunks: string[] = [];
  for (const section of raw) {
    if (section.length <= THREAD_CHUNK_MAX) {
      chunks.push(section);
    } else {
      let remaining = section;
      while (remaining.length > THREAD_CHUNK_MAX) {
        const cut = remaining.lastIndexOf("\n\n", THREAD_CHUNK_MAX);
        const end = cut > 0 ? cut : THREAD_CHUNK_MAX;
        chunks.push(remaining.slice(0, end));
        remaining = remaining.slice(end).trimStart();
      }
      if (remaining) chunks.push(remaining);
    }
  }
  return chunks;
}

export function matchChannelByType(
  routes: ChannelTypeRoute[] | undefined,
  candidate: string | undefined,
): string | null {
  if (!routes || routes.length === 0 || !candidate) return null;
  for (const [pattern, channelId] of routes) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    if (re.test(candidate)) return channelId;
  }
  return null;
}

export async function handleApprovalCreated(
  ctx: PluginContext,
  event: PluginEvent,
  client: Client,
  config: DiscordFleetConfig,
): Promise<void> {
  const companyId = event.companyId;
  const payload = event.payload as ApprovalCreatedPayload;
  const candidateIssueIds = payload.issueIds && payload.issueIds.length > 0
    ? payload.issueIds
    : payload.issueId
      ? [payload.issueId]
      : [];
  const primaryIssueId = candidateIssueIds[0] ?? "";
  const approvalId = payload.approvalId ?? event.entityId ?? "";
  const identifier = payload.identifier ?? (primaryIssueId || approvalId).slice(0, 8);
  const approvalType = payload.type ?? payload.approvalType ?? "unknown";
  const approvalTitle = payload.title ?? `Approval ${approvalId.slice(0, 8)}`;
  const proposedComment = payload.proposedComment ?? "";

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  const seenKey = { scopeKind: "company" as const, scopeId: companyId, stateKey: SEEN_APPROVALS_KEY };
  const seenArr = ((await ctx.state.get(seenKey)) as string[] | null) ?? [];
  const seen = new Set(seenArr);
  if (seen.has(approvalId)) {
    ctx.logger.info("approval-created: already posted, skipping", { approvalId });
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
    approvalTitle,
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

  let bundle: IssueDocsBundle = { issues: [] };
  try {
    const apiKey = await ctx.secrets.resolve(companyConfig.paperclipApiKeySecretRef);
    const paperclip = new PaperclipClient(ctx, companyConfig.paperclipApiUrl, apiKey);
    const issues = await paperclip.getApprovalIssues(approvalId);
    // Promise.allSettled (not Promise.all) — one flaky listIssueDocuments call
    // shouldn't wipe successfully-fetched docs from the other linked issues.
    const settled = await Promise.allSettled(
      issues.map((i) => paperclip.listIssueDocuments(i.id)),
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
    ctx.logger.warn("approval-created: failed to fetch issue docs, falling back to proposedComment", {
      approvalId,
      error: String(err),
    });
  }

  const groups = renderIssueDocs(bundle, approvalId.slice(0, 8));
  let anyBodyPosted = false;
  if (groups.length > 0) {
    for (const group of groups) {
      try {
        await postEmbedsToChannel(client, destinationChannelId, group);
        anyBodyPosted = true;
      } catch (err) {
        ctx.logger.warn("approval-created: rich-group post failed", {
          destinationChannelId,
          error: String(err),
        });
      }
    }
  }
  // Fall back to proposedComment if the rich path produced no successful body posts.
  // Covers both "no groups at all" (non-content approvals) and "every group failed"
  // (Discord 400/5xx, invalid image URL, etc.) so operator still gets something
  // beyond the header card before the approval gets marked SEEN.
  if (!anyBodyPosted && proposedComment) {
    const chunks = chunkBySection(stripSecrets(proposedComment));
    for (const chunk of chunks) {
      try {
        await postToChannel(client, destinationChannelId, truncate(chunk, THREAD_CHUNK_MAX));
      } catch (err) {
        ctx.logger.warn("approval-created: chunk post failed", {
          destinationChannelId,
          error: String(err),
        });
      }
    }
  }

  seen.add(approvalId);
  await ctx.state.set(seenKey, [...seen]);

  const pending = ((await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: PENDING_APPROVALS_KEY,
  })) as string[] | null) ?? [];
  pending.push(approvalId);
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }, pending);
}
