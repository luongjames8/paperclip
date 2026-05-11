import type { Client, TextChannel, ThreadChannel } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import { routeIssue } from "../routing/route.js";
import { postEmbedToChannel, postEmbedToThread } from "../discord/rest.js";
import { buildApprovalActionRow, buildApprovalEmbed } from "../render/embeds.js";
import { truncate } from "../render/plain.js";
import { stripSecrets } from "../render/secrets.js";
import { getThreadForIssue } from "../routing/thread-state.js";

interface ApprovalCreatedPayload {
  approvalId?: string;
  approvalType?: string;
  issueId?: string;
  identifier?: string;
  projectId?: string;
  title?: string;
  summary?: string;
  proposedComment?: string;
}

const PENDING_APPROVALS_KEY = "pending-approvals";
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
  const issueId = payload.issueId ?? event.entityId ?? "";
  const approvalId = payload.approvalId ?? event.entityId ?? "";
  const identifier = payload.identifier ?? issueId.slice(0, 8);
  const approvalType = payload.approvalType ?? "unknown";
  const approvalTitle = payload.title ?? `Approval ${approvalId.slice(0, 8)}`;
  const proposedComment = payload.proposedComment ?? "";

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  // B1 fix: link to /:companyPrefix/approvals/<id> (board canonical route)
  const url = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/approvals/${approvalId}`;
  const embed = buildApprovalEmbed({ identifier, approvalId, approvalType, title: approvalTitle, issueUrl: url });
  const actionRow = buildApprovalActionRow({ approvalId, issueUrl: url });

  // If the issue this approval belongs to has a registered Discord thread,
  // post the approval embed + buttons directly into that thread so it appears
  // alongside the work. Otherwise fall back to the routed channel and the
  // legacy spawn-a-new-thread-for-long-comments behavior.
  const existingThread = issueId
    ? await getThreadForIssue(ctx, companyId, issueId)
    : null;

  if (existingThread) {
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
    const { channelId } = routeIssue(config, companyId, payload.projectId);
    const messageId = await postEmbedToChannel(client, channelId, embed, [actionRow]);

    // Legacy fallback: spawn a thread off the approval message when no work
    // thread exists yet and proposedComment is long enough to be unwieldy
    // inline. Removable once seed-issue thread registration is universal.
    if (proposedComment.length > 200 && messageId) {
      try {
        const channel = (await client.channels.fetch(channelId)) as TextChannel;
        const thread = await channel.threads.create({
          name: approvalTitle.slice(0, 100),
          startMessage: messageId,
          autoArchiveDuration: 1440,
        });
        const chunks = chunkBySection(stripSecrets(proposedComment));
        for (const chunk of chunks) {
          await thread.send({ content: truncate(chunk, THREAD_CHUNK_MAX) });
        }
      } catch (err) {
        ctx.logger.warn("approval-created: thread creation failed", { error: String(err) });
      }
    }
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
