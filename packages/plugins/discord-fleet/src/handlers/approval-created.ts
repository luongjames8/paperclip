import type { Client, ThreadChannel } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import { routeIssue } from "../routing/route.js";
import { postEmbedToChannel, postEmbedToThread } from "../discord/rest.js";
import { buildApprovalActionRow, buildApprovalEmbed } from "../render/embeds.js";
import { truncate } from "../render/plain.js";
import { stripSecrets } from "../render/secrets.js";
import { getThreadForAncestors } from "../routing/thread-state.js";

interface ApprovalCreatedPayload {
  approvalId?: string;
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

export const PENDING_APPROVALS_KEY = "pending-approvals";
const THREAD_CHUNK_MAX = 1990;

function chunkBySection(text: string): string[] {
  // Split on ## headings; each chunk ≤ THREAD_CHUNK_MAX chars
  const raw = text.split(/(?=^## )/m).filter((s) => s.trim());
  const chunks: string[] = [];
  for (const section of raw) {
    if (section.length <= THREAD_CHUNK_MAX) {
      chunks.push(section);
    } else {
      // Section is over limit — split at paragraph boundaries
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

export async function handleApprovalCreated(
  ctx: PluginContext,
  event: PluginEvent,
  client: Client,
  config: DiscordFleetConfig,
): Promise<void> {
  const companyId = event.companyId;
  const payload = event.payload as ApprovalCreatedPayload;
  // event.entityId IS the APPROVAL id (paperclip approval-created activity),
  // not an issue id. Pull linked issues from the plural payload.issueIds
  // first, falling back to legacy singular issueId for compat with older
  // emissions / unit-test fixtures.
  const candidateIssueIds = payload.issueIds && payload.issueIds.length > 0
    ? payload.issueIds
    : payload.issueId
      ? [payload.issueId]
      : [];
  const primaryIssueId = candidateIssueIds[0] ?? "";
  const approvalId = payload.approvalId ?? event.entityId ?? "";
  const identifier = payload.identifier ?? (primaryIssueId || approvalId).slice(0, 8);
  const approvalType = payload.approvalType ?? "unknown";
  const approvalTitle = payload.title ?? `Approval ${approvalId.slice(0, 8)}`;
  const proposedComment = payload.proposedComment ?? "";

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  // B1 fix: link to /:companyPrefix/approvals/<id> (board canonical route)
  const url = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/approvals/${approvalId}`;
  const embed = buildApprovalEmbed({ identifier, approvalId, approvalType, title: approvalTitle, issueUrl: url });
  const actionRow = buildApprovalActionRow({ approvalId, issueUrl: url });

  // If any linked issue has a registered Discord thread (or any ancestor in
  // the chain does), post the approval embed + buttons directly into that
  // thread so it appears alongside the work. getThreadForAncestors walks the
  // array of candidate issue ids and returns the first matching thread.
  const existingThread = candidateIssueIds.length
    ? await getThreadForAncestors(ctx, companyId, candidateIssueIds)
    : null;

  if (existingThread) {
    // Approval embed + buttons go INTO the work's existing thread, alongside
    // the work that produced them. proposedComment posted as follow-up
    // messages in the SAME thread (no new thread spawned — the thread already
    // exists from issue.created registration).
    await postEmbedToThread(client, existingThread.threadId, embed, [actionRow]);
    if (proposedComment) {
      try {
        const thread = (await client.channels.fetch(existingThread.threadId)) as ThreadChannel;
        const chunks = chunkBySection(stripSecrets(proposedComment));
        for (const chunk of chunks) {
          await thread.send({ content: truncate(chunk, THREAD_CHUNK_MAX) });
        }
      } catch (err) {
        ctx.logger.warn("approval-created: posting proposedComment into work thread failed", {
          threadId: existingThread.threadId,
          error: String(err),
        });
      }
    }
  } else {
    // No work thread registered (legacy data pre-dating issue.created thread
    // registration, or an approval not tied to any issue). Post embed + buttons
    // to the routed channel as a flat message. Do NOT spawn a new thread —
    // an orphan "approval thread" detached from the work it concerns is the
    // exact antipattern we're retiring (see bridge/*-poster.py). Operators
    // can click the View button to reach the full proposedComment in
    // paperclip's UI.
    const { channelId } = routeIssue(config, companyId, payload.projectId);
    await postEmbedToChannel(client, channelId, embed, [actionRow]);
  }

  // Record pending approval for digest
  const pending = ((await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: PENDING_APPROVALS_KEY,
  })) as string[] | null) ?? [];
  pending.push(approvalId);
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }, pending);
}
