import type { Client } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import { routeIssue } from "../routing/route.js";
import { postToChannel, postEmbedToChannel, postToThread } from "../discord/rest.js";
import { buildSeedIssueEmbed } from "../render/embeds.js";
import { formatChildIssueCreated } from "../render/plain.js";
import { createThread } from "../discord/threads.js";
import { getThreadForAncestors, setThreadForIssue } from "../routing/thread-state.js";

interface IssueCreatedPayload {
  identifier?: string;
  title?: string;
  status?: string;
  projectId?: string;
  parentId?: string;
  originKind?: string;
  assigneeAgentId?: string;
  ancestorIds?: string[];
}

function issueUrl(baseUrl: string, companyPrefix: string, identifier: string): string {
  return `${baseUrl}/${companyPrefix}/issues/${identifier}`;
}

export async function handleIssueCreated(
  ctx: PluginContext,
  event: PluginEvent,
  client: Client,
  config: DiscordFleetConfig,
): Promise<void> {
  const companyId = event.companyId;
  const issueId = event.entityId ?? "";
  const payload = event.payload as IssueCreatedPayload;
  const identifier = payload.identifier ?? issueId.slice(0, 8);
  const title = payload.title ?? "(no title)";
  const projectId = payload.projectId;
  const parentId = payload.parentId;
  const originKind = payload.originKind;
  const ancestorIds = payload.ancestorIds ?? (parentId ? [parentId] : []);

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  const { channelId } = routeIssue(config, companyId, projectId);
  const isSeed = originKind === "routine_execution" || !parentId;

  if (isSeed) {
    // Seed issues get their own Discord thread under the routed channel; the
    // thread is registered in plugin state so downstream events (approvals,
    // stuck-detector, blocked transitions) can target the work's thread
    // instead of spawning new orphan posts.
    const url = issueUrl(companyConfig.paperclipApiUrl, companyConfig.companyPrefix, identifier);
    const embed = buildSeedIssueEmbed({ identifier, title, assignee: payload.assigneeAgentId, issueUrl: url });
    const threadName = `${identifier} — ${title}`;
    try {
      const entry = await createThread(client, channelId, threadName, embed);
      if (issueId) {
        await setThreadForIssue(ctx, companyId, issueId, entry);
      }
    } catch (err) {
      ctx.logger.warn("issue-created: thread creation failed, falling back to channel post", {
        issueId,
        identifier,
        err: String(err),
      });
      await postEmbedToChannel(client, channelId, embed);
    }
    return;
  }

  // Child issue: post into the nearest ancestor's thread if one is registered,
  // so descendant work stays co-located with parent context. Falls back to a
  // flat channel message when no ancestor has a thread (which is the legacy
  // behavior until enough seed issues have been created post-deploy).
  const ancestorThread = ancestorIds.length
    ? await getThreadForAncestors(ctx, companyId, ancestorIds)
    : null;
  const childText = formatChildIssueCreated(identifier, title, payload.assigneeAgentId);
  if (ancestorThread) {
    await postToThread(client, ancestorThread.threadId, childText);
  } else {
    await postToChannel(client, channelId, childText);
  }
}
