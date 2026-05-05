import type { Client } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import { routeIssue } from "../routing/route.js";
import { postToChannel, postEmbedToChannel } from "../discord/rest.js";
import { buildSeedIssueEmbed } from "../render/embeds.js";
import { formatChildIssueCreated } from "../render/plain.js";

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
  _ctx: PluginContext,
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

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  const { channelId } = routeIssue(config, companyId, projectId);
  const isSeed = originKind === "routine_execution" || !parentId;

  if (isSeed) {
    const url = issueUrl(companyConfig.paperclipApiUrl, companyConfig.companyPrefix, identifier);
    const embed = buildSeedIssueEmbed({ identifier, title, assignee: payload.assigneeAgentId, issueUrl: url });
    await postEmbedToChannel(client, channelId, embed);
  } else {
    await postToChannel(client, channelId, formatChildIssueCreated(identifier, title, payload.assigneeAgentId));
  }
}
