import type { ButtonInteraction } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig, UserMapping } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";
import { APPROVAL_BUTTON_PREFIX } from "../render/embeds.js";
import { PENDING_APPROVALS_KEY } from "./approval-created.js";

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

  // Authorization: the clicker must be in company.userMappings. Discord channel
  // access alone is too coarse a gate — paperclip natively models per-user
  // approver identity via UserMapping + optional per-user boardApiKeySecretRef.
  const mapping = resolveUserMapping(company, interaction.user.id);
  if (!mapping) {
    await interaction.reply({
      content:
        "You're not authorized to act on this approval. Ask an operator to add your Discord user ID to the company's userMappings.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Per-user board key when present makes paperclip record decidedByUserId as
  // the mapped paperclip user (not "board"). Fall back to the company-wide key
  // for mappings that don't have a personal board key configured.
  const note = `discord:${interaction.user.username}`;

  try {
    const apiKey = await ctx.secrets.resolve(
      mapping.boardApiKeySecretRef ?? company.paperclipApiKeySecretRef,
    );
    const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
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

  // Mirror approval-created's append: remove the resolved id from pending
  // state so /status and the daily digest don't keep showing stale entries
  // after operators act via the button.
  await removeFromPending(ctx, company.companyId, parsed.approvalId);

  await renderResolved(interaction, parsed.action);
}

function resolveUserMapping(company: CompanyConfig, discordUserId: string): UserMapping | undefined {
  return company.userMappings?.find((m) => m.discordUserId === discordUserId);
}

async function removeFromPending(
  ctx: PluginContext,
  companyId: string,
  approvalId: string,
): Promise<void> {
  const key = { scopeKind: "company" as const, scopeId: companyId, stateKey: PENDING_APPROVALS_KEY };
  const current = ((await ctx.state.get(key)) as string[] | null) ?? [];
  const next = current.filter((id) => id !== approvalId);
  if (next.length !== current.length) {
    await ctx.state.set(key, next);
  }
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
