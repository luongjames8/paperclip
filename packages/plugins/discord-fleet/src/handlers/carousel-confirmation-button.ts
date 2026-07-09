import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig } from "../config/schema.js";
import { PaperclipClient, PaperclipApiError } from "../api/paperclip.js";
import {
  CAROUSEL_CONFIRM_BUTTON_PREFIX,
  CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX,
  CAROUSEL_CONFIRM_REJECT_REASON_FIELD,
} from "../render/embeds.js";

export type CarouselConfirmAction = "accept" | "reject";

export interface ParsedCarouselConfirmCustomId {
  action: CarouselConfirmAction;
  issueId: string;
  interactionId: string;
}

// customId shape: `<prefix>:<issueId>:<interactionId>` — issueId and
// interactionId are UUIDs (no ":" in either), so splitting on the FIRST ":"
// after the prefix is unambiguous.
export function parseCarouselConfirmCustomId(customId: string): ParsedCarouselConfirmCustomId | null {
  for (const [action, prefix] of Object.entries(CAROUSEL_CONFIRM_BUTTON_PREFIX) as Array<
    [CarouselConfirmAction, string]
  >) {
    if (!customId.startsWith(prefix)) continue;
    const rest = customId.slice(prefix.length);
    const sep = rest.indexOf(":");
    if (sep === -1) return null;
    const issueId = rest.slice(0, sep);
    const interactionId = rest.slice(sep + 1);
    if (!issueId || !interactionId) return null;
    return { action, issueId, interactionId };
  }
  return null;
}

export function parseCarouselConfirmRejectModalCustomId(customId: string): { issueId: string; interactionId: string } | null {
  if (!customId.startsWith(CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX)) return null;
  const rest = customId.slice(CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  const issueId = rest.slice(0, sep);
  const interactionId = rest.slice(sep + 1);
  if (!issueId || !interactionId) return null;
  return { issueId, interactionId };
}

function resolveCompany(config: DiscordFleetConfig, guildId: string | null): CompanyConfig | undefined {
  if (!guildId) return undefined;
  return config.companies.find((c) => c.guildId === guildId);
}

async function stripComponentsAndAnnotate(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  label: string,
): Promise<void> {
  const original = interaction.message?.embeds?.[0]?.toJSON();
  if (!original) return;
  await interaction.editReply({
    embeds: [{ ...original, footer: { text: label } }],
    components: [],
  });
}

export async function handleCarouselConfirmationButton(
  ctx: PluginContext,
  interaction: ButtonInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseCarouselConfirmCustomId(interaction.customId);
  if (!parsed) return;

  const company = resolveCompany(config, interaction.guildId);
  if (!company) {
    await interaction.reply({ content: "No company configured for this guild.", ephemeral: true });
    return;
  }

  // Reject opens a modal to collect the required reason — showModal MUST be
  // the interaction's first response (mirrors the approval-button revision
  // pattern), so this branch runs BEFORE deferUpdate.
  if (parsed.action === "reject") {
    const modal = new ModalBuilder()
      .setCustomId(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${parsed.issueId}:${parsed.interactionId}`)
      .setTitle("Reject carousel batch")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(CAROUSEL_CONFIRM_REJECT_REASON_FIELD)
            .setLabel("Why is this batch being rejected?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1500),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  try {
    await interaction.deferUpdate();
  } catch (err: any) {
    if (err?.code === 10062) {
      ctx.logger.warn("carousel-confirmation-button: interaction expired before deferUpdate (3s window)", {
        issueId: parsed.issueId,
        interactionId: parsed.interactionId,
        action: parsed.action,
      });
      return;
    }
    throw err;
  }

  try {
    const apiKey = await ctx.secrets.resolve(company.paperclipApiKeySecretRef);
    const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
    await paperclip.acceptInteraction(parsed.issueId, parsed.interactionId);
  } catch (err) {
    ctx.logger.warn("carousel-confirmation-button: acceptInteraction failed", {
      issueId: parsed.issueId,
      interactionId: parsed.interactionId,
      err: String(err),
    });
    const status = err instanceof PaperclipApiError ? err.status : undefined;
    const prefix = status === 409 ? "Already resolved elsewhere: " : status === 422 ? "Rejected by server: " : "Failed to accept: ";
    await interaction.followUp({
      content: `${prefix}${String(err).slice(0, 200)}`,
      ephemeral: true,
    });
    return;
  }

  const actor = interaction.user.username;
  const stamp = new Date().toISOString();
  await stripComponentsAndAnnotate(interaction, `✅ Accepted by ${actor} at ${stamp}`);
}

// Handles the "Reject" modal submit: collects the required reason and calls
// rejectInteraction. On success, edits the trailer message in place.
export async function handleCarouselConfirmationRejectModal(
  ctx: PluginContext,
  interaction: ModalSubmitInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseCarouselConfirmRejectModalCustomId(interaction.customId);
  if (!parsed) return;

  const company = resolveCompany(config, interaction.guildId);
  if (!company) {
    await interaction.reply({ content: "No company configured for this guild.", ephemeral: true });
    return;
  }

  const reason = interaction.fields.getTextInputValue(CAROUSEL_CONFIRM_REJECT_REASON_FIELD).trim();
  if (!reason) {
    await interaction.reply({ content: "A rejection reason is required.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  try {
    const apiKey = await ctx.secrets.resolve(company.paperclipApiKeySecretRef);
    const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
    await paperclip.rejectInteraction(parsed.issueId, parsed.interactionId, reason);
  } catch (err) {
    ctx.logger.warn("carousel-confirmation-reject-modal: rejectInteraction failed", {
      issueId: parsed.issueId,
      interactionId: parsed.interactionId,
      err: String(err),
    });
    const status = err instanceof PaperclipApiError ? err.status : undefined;
    const prefix = status === 409 ? "Already resolved elsewhere: " : status === 422 ? "Rejected by server: " : "Failed to reject: ";
    await interaction.followUp({
      content: `${prefix}${String(err).slice(0, 200)}`,
      ephemeral: true,
    });
    return;
  }

  const actor = interaction.user.username;
  const stamp = new Date().toISOString();
  await stripComponentsAndAnnotate(interaction, `❌ Rejected by ${actor} at ${stamp} — ${reason}`);
}
