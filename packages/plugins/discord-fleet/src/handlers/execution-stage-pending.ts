import type { Client } from "discord.js";
import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import { matchChannelByType, routeIssue } from "../routing/route.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { buildExecutionStageActionRow, buildExecutionStagePendingEmbed } from "../render/embeds.js";
import { postExecutionStageDeliveryFailureFallback } from "./delivery-fallback.js";

// Payload shape emitted by publishExecutionStagePendingEventIfChanged (server/src/routes/issues.ts).
interface ExecutionStagePendingPayload {
  issueId?: string;
  identifier?: string;
  title?: string;
  projectId?: string;
  stageId?: string;
  stageType?: "review" | "approval";
  lastDecisionId?: string | null;
  participant?: { type?: "agent" | "user"; agentId?: string | null; userId?: string | null } | null;
}

// Renders an executionPolicy review/approval stage as a clickable Discord
// card (fleet issue #631 / PR-0). Only user-type participants get a card —
// an agent-type participant is already woken natively via the runtime's
// buildExecutionStageWakeup path (heartbeat, acting via its own API access);
// rendering an actionable card for that case would let a Discord user
// override the assigned agent's review.
export async function handleExecutionStagePending(
  ctx: PluginContext,
  event: PluginEvent,
  client: Client,
  config: DiscordFleetConfig,
): Promise<void> {
  const companyId = event.companyId;
  const payload = event.payload as ExecutionStagePendingPayload;
  const issueId = payload.issueId ?? event.entityId ?? "";
  const identifier = payload.identifier ?? issueId.slice(0, 8);

  if (payload.participant?.type !== "user") {
    ctx.logger.info("execution-stage-pending: participant is not a Discord-addressable user, skipping card", {
      companyId,
      issueId,
      participantType: payload.participant?.type ?? "unknown",
    });
    return;
  }

  if (!payload.stageId) {
    ctx.logger.warn("execution-stage-pending: event missing stageId, cannot render a stale-safe card, skipping", {
      companyId,
      issueId,
    });
    return;
  }

  const companyConfig = config.companies.find((c) => c.companyId === companyId);
  if (!companyConfig) return;

  const matchedChannelId = matchChannelByType(
    config.executionStageChannelsByType?.[companyId],
    [payload.identifier, payload.title],
  );
  const destinationChannelId =
    matchedChannelId ?? routeIssue(config, companyId, payload.projectId).channelId;

  const url = `${companyConfig.paperclipApiUrl}/${companyConfig.companyPrefix}/issues/${identifier}`;
  const embed = buildExecutionStagePendingEmbed({
    identifier,
    title: payload.title,
    stageType: payload.stageType === "approval" ? "approval" : "review",
    issueUrl: url,
  });
  const actionRow = buildExecutionStageActionRow({
    issueId,
    stageId: payload.stageId,
    lastDecisionId: payload.lastDecisionId,
    issueUrl: url,
  });

  try {
    await postEmbedToChannel(client, destinationChannelId, embed, [actionRow]);
  } catch (err) {
    // codex round 10: a channel-level post failure (bad/deleted
    // destinationChannelId, missing permission override, archived thread)
    // while the bot IS connected used to only log here, same silent-drop
    // failure mode worker.ts's no-client branch had before round 9 — mirrors
    // approval-created.ts's header-card catch with the execution-stage
    // fallback added in that same round.
    ctx.logger.error("execution-stage-pending: card post failed", {
      issueId,
      companyId,
      destinationChannelId,
      error: String(err),
    });
    await postExecutionStageDeliveryFailureFallback(
      ctx,
      config,
      event,
      `card post to Discord channel ${destinationChannelId} failed: ${String(err)}`,
    );
  }
}
