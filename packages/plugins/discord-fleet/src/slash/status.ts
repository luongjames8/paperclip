import type { ChatInputCommandInteraction } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig } from "../config/schema.js";
import type { PaperclipClient } from "../api/paperclip.js";

const PENDING_APPROVALS_KEY = "pending-approvals";

export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction,
  ctx: PluginContext,
  companyConfig: CompanyConfig,
  paperclip: PaperclipClient,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const companyId = companyConfig.companyId;
  const [inProgress, pendingRaw, errors] = await Promise.all([
    paperclip.getInProgressIssues(companyId),
    ctx.state.get({ scopeKind: "company", scopeId: companyId, stateKey: PENDING_APPROVALS_KEY }),
    paperclip.getErrorsLast24h(companyId),
  ]);

  const pending = (pendingRaw as string[] | null) ?? [];

  const lines = [
    `**Fleet status — ${companyConfig.companyId}**`,
    `🔵 In-flight issues: **${inProgress.length}**`,
    `🟡 Pending approvals: **${pending.length}**`,
    `⛔ Errors (last 24h): **${errors.length}**`,
  ];

  await interaction.editReply({ content: lines.join("\n") });
}
