import type { ButtonInteraction } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";
import { APPROVAL_BUTTON_PREFIX } from "../render/embeds.js";

export type ApprovalAction = "approve" | "reject";

export function parseApprovalCustomId(customId: string): { action: ApprovalAction; approvalId: string } | null {
  if (customId.startsWith(APPROVAL_BUTTON_PREFIX.approve)) {
    return { action: "approve", approvalId: customId.slice(APPROVAL_BUTTON_PREFIX.approve.length) };
  }
  if (customId.startsWith(APPROVAL_BUTTON_PREFIX.reject)) {
    return { action: "reject", approvalId: customId.slice(APPROVAL_BUTTON_PREFIX.reject.length) };
  }
  return null;
}

export async function handleApprovalButton(
  ctx: PluginContext,
  interaction: ButtonInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseApprovalCustomId(interaction.customId);
  if (!parsed) return;

  const company = resolveCompany(config, interaction.guildId);
  if (!company) {
    await interaction.reply({ content: "No company configured for this guild.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const apiKey = await ctx.secrets.resolve(company.paperclipApiKeySecretRef);
  const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
  const note = `discord:${interaction.user.username}`;

  try {
    if (parsed.action === "approve") {
      await paperclip.approveApproval(parsed.approvalId, note);
    } else {
      await paperclip.rejectApproval(parsed.approvalId, note);
    }
  } catch (err) {
    ctx.logger.warn("approval-button: paperclip API call failed", {
      action: parsed.action,
      approvalId: parsed.approvalId,
      err: String(err),
    });
    await interaction.followUp({
      content: `Failed to ${parsed.action}: ${String(err).slice(0, 200)}`,
      ephemeral: true,
    });
    return;
  }

  await renderResolved(interaction, parsed.action);
}

function resolveCompany(config: DiscordFleetConfig, guildId: string | null): CompanyConfig | undefined {
  if (!guildId) return undefined;
  return config.companies.find((c) => c.guildId === guildId);
}

async function renderResolved(interaction: ButtonInteraction, action: ApprovalAction): Promise<void> {
  const original = interaction.message.embeds[0]?.toJSON();
  if (!original) return;

  const color = action === "approve" ? 0x57f287 : 0xed4245;
  const prefix = action === "approve" ? "✅ Approved" : "❌ Rejected";
  const actor = interaction.user.username;
  const stamp = new Date().toISOString();

  await interaction.editReply({
    embeds: [
      {
        ...original,
        color,
        title: `${prefix} — ${(original.title ?? "approval").replace(/^[🟡🔴🟢✅❌]\s*/u, "")}`,
        footer: { text: `${prefix} by ${actor} at ${stamp}` },
      },
    ],
    components: [],
  });
}
