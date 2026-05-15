import type {
  APIActionRowComponent,
  APIComponentInMessageActionRow,
  APIEmbed,
  Client,
} from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { ChannelTypeRoute, DiscordFleetConfig } from "../config/schema.js";
import { postEmbedToChannel, postToChannel } from "../discord/rest.js";
import { buildApprovalActionRow, buildApprovalEmbed } from "../render/embeds.js";
import { truncate } from "../render/plain.js";
import { stripSecrets } from "../render/secrets.js";
import { getThreadForAncestors } from "../routing/thread-state.js";

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

export const PENDING_APPROVALS_KEY = "pending-approvals";
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

function matchChannelByType(
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

async function postEmbedAndChunks(
  ctx: PluginContext,
  client: Client,
  destinationId: string,
  embed: APIEmbed,
  components: Array<APIActionRowComponent<APIComponentInMessageActionRow>>,
  proposedComment: string,
): Promise<void> {
  // postEmbedToChannel + postToChannel both call client.channels.fetch(id).send(),
  // which works for both TextChannel and ThreadChannel — the destination can be
  // either, and Discord.js .send() is unified across them.
  await postEmbedToChannel(client, destinationId, embed, components);
  if (!proposedComment) return;
  const chunks = chunkBySection(stripSecrets(proposedComment));
  for (const chunk of chunks) {
    try {
      await postToChannel(client, destinationId, truncate(chunk, THREAD_CHUNK_MAX));
    } catch (err) {
      ctx.logger.warn("approval-created: posting proposedComment chunk failed", {
        destinationId,
        error: String(err),
      });
    }
  }
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

  const url = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/approvals/${approvalId}`;
  const embed = buildApprovalEmbed({ identifier, approvalId, approvalType, title: approvalTitle, issueUrl: url });
  const actionRow = buildApprovalActionRow({ approvalId, issueUrl: url });

  // Routing precedence:
  //   1. approvalsChannelsByType regex match on approval title (operator's
  //      explicit content-surface routing — highest priority).
  //   2. Existing work-thread/destination from parent issue (co-locates
  //      the approval with the work that produced it).
  //   3. approvalFallbackChannelId (system-dump approvals channel).
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
      config.approvalFallbackChannelId ??
      companyConfig.channels.orphan;
  }

  await postEmbedAndChunks(ctx, client, destinationChannelId, embed, [actionRow], proposedComment);

  const pending = ((await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: PENDING_APPROVALS_KEY,
  })) as string[] | null) ?? [];
  pending.push(approvalId);
  await ctx.state.set({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }, pending);
}
