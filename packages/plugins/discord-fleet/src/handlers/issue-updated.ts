import type { Client } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { CoalesceBuffer } from "../util/coalesce.js";
import { coalesceKey } from "../util/coalesce.js";
import { routeIssue } from "../routing/route.js";
import { postToChannel, postEmbedToChannel } from "../discord/rest.js";
import { formatIssueUpdated } from "../render/plain.js";
import { buildBlockedEmbed } from "../render/embeds.js";

interface IssueUpdatedPayload {
  identifier?: string;
  title?: string;
  status?: string;
  projectId?: string;
  reason?: string;
}

export async function handleIssueUpdated(
  _ctx: PluginContext,
  event: PluginEvent,
  client: Client,
  config: DiscordFleetConfig,
  coalescer: CoalesceBuffer,
): Promise<void> {
  const companyId = event.companyId;
  const issueId = event.entityId ?? "";
  const payload = event.payload as IssueUpdatedPayload;
  const identifier = payload.identifier ?? issueId.slice(0, 8);
  const status = payload.status ?? "unknown";

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  const { channelId } = routeIssue(config, companyId, payload.projectId);
  const key = coalesceKey(channelId, issueId);

  if (status === "blocked") {
    const url = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/issues/${identifier}`;
    const embed = buildBlockedEmbed({ identifier, title: payload.title ?? "", reason: payload.reason, issueUrl: url });
    await postEmbedToChannel(client, channelId, embed);
    return;
  }

  coalescer.schedule(key, async () => {
    await postToChannel(client, channelId, formatIssueUpdated(identifier, status, payload.reason));
  });
}
