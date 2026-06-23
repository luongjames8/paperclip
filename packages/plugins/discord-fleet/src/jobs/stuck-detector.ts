import type { Client } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { DiscordFleetConfig } from "../config/schema.js";
import type { PaperclipClient } from "../api/paperclip.js";
import { postEmbedToChannel } from "../discord/rest.js";
import { getThreadForIssue } from "../routing/thread-state.js";
import { postEmbedToThread } from "../discord/rest.js";
import { buildStuckIssueEmbed } from "../render/embeds.js";

export async function runStuckDetector(
  ctx: PluginContext,
  getClient: (companyId: string) => Client | null,
  config: DiscordFleetConfig,
  paperclipFactory: (companyId: string) => Promise<PaperclipClient>,
): Promise<void> {
  for (const company of config.companies) {
    if (!company.companyPrefix?.trim()) {
      ctx.logger.warn("discord-fleet: companyPrefix missing or empty; skipping company", { companyId: company.companyId });
      continue;
    }
    if (company.stuckIssueThresholdHours < 1) {
      ctx.logger.warn("discord-fleet: stuckIssueThresholdHours < 1 is invalid; skipping company", { companyId: company.companyId });
      continue;
    }
    const client = getClient(company.companyId);
    if (!client) continue;
    const paperclip = await paperclipFactory(company.companyId);
    const issues = await paperclip.getInProgressIssues(company.companyId);
    const now = Date.now();

    for (const issue of issues) {
      const updatedMs = new Date(issue.updatedAt).getTime();
      const hoursStuck = Math.floor((now - updatedMs) / 3_600_000);

      if (hoursStuck < company.stuckIssueThresholdHours) continue;

      const url = `${company.paperclipApiUrl}/${company.companyPrefix}/issues/${issue.identifier}`;
      const embed = buildStuckIssueEmbed({
        identifier: issue.identifier,
        title: issue.title,
        hoursStuck,
        assignee: issue.assigneeId,
        issueUrl: url,
      });

      const threadEntry = await getThreadForIssue(ctx, company.companyId, issue.id);
      if (threadEntry) {
        await postEmbedToThread(client, threadEntry.threadId, embed);
      }
      await postEmbedToChannel(client, company.channels.errors, embed);
    }
  }
}
