import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig, UserMapping } from "../config/schema.js";
import { PaperclipClient, PaperclipApiError } from "../api/paperclip.js";
import {
  CAROUSEL_CONFIRM_BUTTON_PREFIX,
  CAROUSEL_CONFIRM_BUTTON_PREFIX_LEGACY,
  CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX,
  CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY,
  CAROUSEL_CONFIRM_REJECT_REASON_FIELD,
  CAROUSEL_HASH_TOKEN_LEN,
} from "../render/embeds.js";
import { sha256 } from "../jobs/confirmation-sweep.js";

export type CarouselConfirmAction = "accept" | "reject";

export interface ParsedCarouselConfirmCustomId {
  action: CarouselConfirmAction;
  issueId: string;
  interactionId: string;
  // Version token (first CAROUSEL_HASH_TOKEN_LEN hex chars of the posted
  // artifact's sha256). Absent (undefined) means this customId came from a
  // pre-versioning trailer — unverifiable, always treated as stale.
  hash8?: string;
}

// New (versioned) customId shape: `<prefix>:<hash8>:<issueId>:<interactionId>`.
// Legacy (pre-versioning) shape: `<legacyPrefix><issueId>:<interactionId>` (no
// hash segment) — parsed with hash8 left undefined so callers can route it to
// the stale-refusal path (see FIX (a), PR #27 codex round 3).
export function parseCarouselConfirmCustomId(customId: string): ParsedCarouselConfirmCustomId | null {
  for (const [action, prefix] of Object.entries(CAROUSEL_CONFIRM_BUTTON_PREFIX) as Array<
    [CarouselConfirmAction, string]
  >) {
    if (!customId.startsWith(prefix)) continue;
    const rest = customId.slice(prefix.length);
    const parts = rest.split(":");
    if (parts.length !== 3) return null;
    const [hash8, issueId, interactionId] = parts;
    if (!hash8 || !issueId || !interactionId) return null;
    return { action, issueId, interactionId, hash8 };
  }
  for (const [action, prefix] of Object.entries(CAROUSEL_CONFIRM_BUTTON_PREFIX_LEGACY) as Array<
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

export interface ParsedCarouselConfirmRejectModalCustomId {
  issueId: string;
  interactionId: string;
  hash8?: string;
}

export function parseCarouselConfirmRejectModalCustomId(customId: string): ParsedCarouselConfirmRejectModalCustomId | null {
  if (customId.startsWith(CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX)) {
    const rest = customId.slice(CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX.length);
    const parts = rest.split(":");
    if (parts.length !== 3) return null;
    const [hash8, issueId, interactionId] = parts;
    if (!hash8 || !issueId || !interactionId) return null;
    return { issueId, interactionId, hash8 };
  }
  if (customId.startsWith(CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY)) {
    const rest = customId.slice(CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY.length);
    const sep = rest.indexOf(":");
    if (sep === -1) return null;
    const issueId = rest.slice(0, sep);
    const interactionId = rest.slice(sep + 1);
    if (!issueId || !interactionId) return null;
    return { issueId, interactionId };
  }
  return null;
}

// Re-fetches the interaction and recomputes its detailsMarkdown hash8 to
// compare against the customId's version token (FIX (a), PR #27 codex round
// 3). Returns true when the click is safe to act on: the token is present AND
// matches the CURRENT artifact hash. Any other outcome (no token — legacy
// customId; interaction not found/gone; hash mismatch — a newer version was
// posted) returns false and the caller must refuse with NO further API call.
async function isCurrentVersion(
  paperclip: PaperclipClient,
  issueId: string,
  interactionId: string,
  hash8: string | undefined,
): Promise<boolean> {
  if (!hash8) return false;
  let interactions;
  try {
    interactions = await paperclip.listIssueInteractions(issueId);
  } catch {
    return false;
  }
  const current = interactions.find((i) => i.id === interactionId);
  if (!current) return false;
  const rawDetails = current.payload?.detailsMarkdown;
  const rawPrompt = current.payload?.prompt;
  const detailsMarkdown =
    typeof rawDetails === "string" && rawDetails.trim()
      ? rawDetails.trim()
      : typeof rawPrompt === "string" && rawPrompt.trim()
        ? rawPrompt.trim()
        : "";
  return sha256(detailsMarkdown).slice(0, CAROUSEL_HASH_TOKEN_LEN) === hash8;
}

const STALE_TRAILER_MESSAGE =
  "This card is stale — a newer version of the batch was posted below. Use the newest card.";

function resolveCompany(config: DiscordFleetConfig, guildId: string | null): CompanyConfig | undefined {
  if (!guildId) return undefined;
  return config.companies.find((c) => c.guildId === guildId);
}

function resolveUserMapping(company: CompanyConfig, discordUserId: string): UserMapping | undefined {
  return company.userMappings?.find((m) => m.discordUserId === discordUserId);
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

  // Authorization: the clicker must be in company.userMappings. Discord channel
  // access alone is too coarse a gate — mirrors approval-button's gate exactly
  // (a batch accept/reject is a board decision just like an approval decision).
  const mapping = resolveUserMapping(company, interaction.user.id);
  if (!mapping) {
    await interaction.reply({
      content:
        "You're not authorized to act on this approval. Ask an operator to add your Discord user ID to the company's userMappings.",
      ephemeral: true,
    });
    return;
  }

  // Version-token check (FIX (a), PR #27 codex round 3): a legacy (no hash8)
  // customId or a hash8 that no longer matches the interaction's CURRENT
  // detailsMarkdown means either a stale trailer from before a revision, or
  // an un-versioned pre-deploy trailer — either way, unverifiable, so refuse
  // before any accept/reject API call and before opening the reject modal.
  const apiKey = await ctx.secrets.resolve(mapping.boardApiKeySecretRef ?? company.paperclipApiKeySecretRef);
  const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
  const isCurrent = await isCurrentVersion(paperclip, parsed.issueId, parsed.interactionId, parsed.hash8);
  if (!isCurrent) {
    await interaction.reply({ content: STALE_TRAILER_MESSAGE, ephemeral: true });
    return;
  }

  // Reject opens a modal to collect the required reason — showModal MUST be
  // the interaction's first response (mirrors the approval-button revision
  // pattern), so this branch runs BEFORE deferUpdate.
  if (parsed.action === "reject") {
    const modal = new ModalBuilder()
      .setCustomId(`${CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX}${parsed.hash8}:${parsed.issueId}:${parsed.interactionId}`)
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

  // Re-check authorization on submit — the modal is a fresh interaction.
  const mapping = resolveUserMapping(company, interaction.user.id);
  if (!mapping) {
    await interaction.reply({
      content:
        "You're not authorized to act on this approval. Ask an operator to add your Discord user ID to the company's userMappings.",
      ephemeral: true,
    });
    return;
  }

  const reason = interaction.fields.getTextInputValue(CAROUSEL_CONFIRM_REJECT_REASON_FIELD).trim();
  if (!reason) {
    await interaction.reply({ content: "A rejection reason is required.", ephemeral: true });
    return;
  }

  // Version-token re-check on submit (FIX (a), PR #27 codex round 3): time may
  // have passed between the modal being shown and submitted, and a legacy
  // (no hash8) modal customId is unverifiable regardless — refuse before any
  // rejectInteraction API call.
  const apiKey = await ctx.secrets.resolve(mapping.boardApiKeySecretRef ?? company.paperclipApiKeySecretRef);
  const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
  const isCurrent = await isCurrentVersion(paperclip, parsed.issueId, parsed.interactionId, parsed.hash8);
  if (!isCurrent) {
    await interaction.reply({ content: STALE_TRAILER_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  try {
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
