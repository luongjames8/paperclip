import type { Client } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { ChannelTypeRoute, DiscordFleetConfig } from "../config/schema.js";
import { routeIssue } from "../routing/route.js";
import { postToChannel, postEmbedToChannel, postToThread } from "../discord/rest.js";
import { buildSeedIssueEmbed } from "../render/embeds.js";
import { formatChildIssueCreated } from "../render/plain.js";
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

function matchChannelByType(
  routes: ChannelTypeRoute[] | undefined,
  candidates: Array<string | undefined>,
): string | null {
  if (!routes || routes.length === 0) return null;
  for (const [pattern, channelId] of routes) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    for (const value of candidates) {
      if (value && re.test(value)) return channelId;
    }
  }
  return null;
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

  const isSeed = originKind === "routine_execution" || !parentId;

  if (isSeed) {
    const matchedChannelId = matchChannelByType(
      config.issuesChannelsByType?.[companyId],
      [payload.identifier, payload.title],
    );
    const destinationChannelId =
      matchedChannelId ?? routeIssue(config, companyId, projectId).channelId;

    const url = issueUrl(companyConfig.paperclipApiUrl, companyConfig.companyPrefix, identifier);
    const embed = buildSeedIssueEmbed({ identifier, title, assignee: payload.assigneeAgentId, issueUrl: url });

    await postEmbedToChannel(client, destinationChannelId, embed);

    if (issueId) {
      // Record destination so child issues co-locate via getThreadForAncestors.
      // Discord.js .send() works on both channels and threads; storing the
      // resolved destination under threadId keeps downstream lookups unchanged.
      await setThreadForIssue(ctx, companyId, issueId, {
        channelId: destinationChannelId,
        threadId: destinationChannelId,
        createdAt: new Date().toISOString(),
      });
    }
    return;
  }

  const ancestorThread = ancestorIds.length
    ? await getThreadForAncestors(ctx, companyId, ancestorIds)
    : null;
  const childText = formatChildIssueCreated(identifier, title, payload.assigneeAgentId);
  if (ancestorThread) {
    await postToThread(client, ancestorThread.threadId, childText);
  } else {
    const { channelId } = routeIssue(config, companyId, projectId);
    await postToChannel(client, channelId, childText);
  }
}
