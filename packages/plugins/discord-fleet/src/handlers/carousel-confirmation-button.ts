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
  buildCarouselAnchorEmbed,
} from "../render/embeds.js";
import { carouselArtifactHash } from "../render/carousel-batch.js";

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

// Re-fetches the interaction and recomputes its CURRENT artifact hash8 via
// carouselArtifactHash — the SAME single-source-of-truth helper the sweep
// uses to version the customId in the first place (kills codex P1: the sweep
// used to hash JSON.stringify(structuredPayload) for structured cards while
// this function only ever hashed detailsMarkdown/prompt, so the two hashes
// could never match and every structured-card Accept/Reject was refused as
// stale). Returns true when the click is safe to act on: the token is
// present AND matches the CURRENT artifact hash. Any other outcome (no
// token — legacy customId; interaction not found/gone; hash mismatch — a
// newer version was posted) returns false and the caller must refuse with NO
// further API call.
//
// ACK-FIRST (2026-07-11 live incident, failure 1): this function performs a
// paperclip API fetch (listIssueInteractions) — real network I/O. Discord
// gives exactly 3 seconds for a button interaction's FIRST response
// (deferUpdate/showModal/reply). Calling this BEFORE that first response —
// as the pre-incident code did — routinely blew the 3s window under any
// latency at all, producing DiscordAPIError 10062 ("Unknown interaction") at
// the next Discord call, which was then swallowed by a generic catch,
// leaving the operator's click with NO visible outcome whatsoever. This
// function must ONLY ever be called AFTER the interaction has already been
// acked (deferUpdate/deferReply/showModal already sent).
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
  return carouselArtifactHash(current).slice(0, CAROUSEL_HASH_TOKEN_LEN) === hash8;
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

// Edits the anchor (interaction.message — the same message the buttons live
// on) to a terminal status. Reuses the shared buildCarouselAnchorEmbed so the
// anchor's visual shape is IDENTICAL whether the edit was sweep-driven
// (superseded) or button-driven (accepted/rejected) — one render, one
// status vocabulary, no drift between the two edit paths.
async function renderAnchorResolved(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  status: "accepted" | "rejected",
  detail: string,
): Promise<void> {
  const original = interaction.message?.embeds?.[0];
  // issueUrl is embedded in the ORIGINAL anchor's description (as a markdown
  // link) — the handler never re-derives company/issueUrl at this point, so
  // reuse whatever the sweep already rendered rather than re-fetching.
  const issueUrlMatch = original?.description ? /\((https?:\/\/[^)]+)\)/.exec(original.description) : null;
  const issueUrl = issueUrlMatch ? issueUrlMatch[1] : "";
  await interaction.editReply({
    embeds: [buildCarouselAnchorEmbed({ issueUrl, status, detail })],
    components: [],
  });
}

// ─── Accept/Reject button click ──────────────────────────────────────────
//
// ACK-FIRST (kills failure 1, 2026-07-11 live incident): the interaction's
// FIRST response is ALWAYS either deferUpdate() (accept) or showModal()
// (reject) — both fire before ANY company/authorization/version-token lookup,
// so a slow paperclip fetch can never burn the 3s window and eat the click
// silently. Every branch after that first response has a full 15-minute
// interaction-token lifetime to work with and MUST end in a visible outcome
// (editReply/followUp) — nothing here may `return` silently once acked.
export async function handleCarouselConfirmationButton(
  ctx: PluginContext,
  interaction: ButtonInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseCarouselConfirmCustomId(interaction.customId);
  if (!parsed) return;

  // Reject: showModal MUST be the interaction's unconditional first response
  // (Discord rejects any other first-response type on a click that opens a
  // modal). ALL validation (company/authorization/version-token) is deferred
  // to the modal SUBMIT interaction below, which gets its OWN fresh 3s/15min
  // token and can ack-first there too.
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
    try {
      await interaction.showModal(modal);
    } catch (err: any) {
      if (err?.code === 10062) {
        ctx.logger.warn("carousel-confirmation-button: interaction expired before showModal (3s window)", {
          issueId: parsed.issueId,
          interactionId: parsed.interactionId,
        });
        return;
      }
      throw err;
    }
    return;
  }

  // Accept: deferUpdate is the FIRST await, before any I/O whatsoever.
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

  // Everything below runs AFTER the ack — a full 15-minute token window, and
  // every exit from here on must be a visible followUp (never a silent
  // return): the operator already saw Discord accept their click, so an
  // unexplained non-outcome is now MORE confusing than an error message. The
  // outer try/catch is defense-in-depth against ANYTHING unforeseen throwing
  // here — the top-level dispatcher (discord/slash.ts) also swallows-and-logs
  // to keep the plugin worker alive, but that swallow is console.error ONLY,
  // no Discord followUp, which is exactly how failure 1 went invisible.
  // Since the interaction is ALREADY acked at this point, a best-effort
  // followUp here is always possible — never let this handler exit through
  // that outer swallow without one.
  try {
    const company = resolveCompany(config, interaction.guildId);
    if (!company) {
      await interaction.followUp({ content: "No company configured for this guild.", ephemeral: true });
      return;
    }

    // Authorization: the clicker must be in company.userMappings. Discord channel
    // access alone is too coarse a gate — mirrors approval-button's gate exactly
    // (a batch accept/reject is a board decision just like an approval decision).
    const mapping = resolveUserMapping(company, interaction.user.id);
    if (!mapping) {
      await interaction.followUp({
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
    // before any accept API call.
    const apiKey = await ctx.secrets.resolve(mapping.boardApiKeySecretRef ?? company.paperclipApiKeySecretRef);
    const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
    const isCurrent = await isCurrentVersion(paperclip, parsed.issueId, parsed.interactionId, parsed.hash8);
    if (!isCurrent) {
      await interaction.followUp({ content: STALE_TRAILER_MESSAGE, ephemeral: true });
      return;
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
    await renderAnchorResolved(interaction, "accepted", `Accepted by ${actor} at ${stamp}`);
  } catch (err) {
    ctx.logger.warn("carousel-confirmation-button: unexpected error after ack — surfacing to operator, not swallowing", {
      issueId: parsed.issueId,
      interactionId: parsed.interactionId,
      err: String(err),
    });
    await interaction
      .followUp({ content: `⚠️ Something went wrong handling your click: ${String(err).slice(0, 200)}`, ephemeral: true })
      .catch(() => {
        // Truly nothing left to do — the 15-minute followUp window itself
        // expired, or Discord is unreachable. The outer dispatcher's
        // console.error swallow is the last line of defense here.
      });
  }
}

// Handles the "Reject" modal submit: collects the required reason and calls
// rejectInteraction. On success, edits the anchor message in place.
//
// ACK-FIRST: deferUpdate() is the first await here too — this is a FRESH
// interaction (its own token, its own 3s/15min window) distinct from the
// button click that opened the modal, so it needs its own ack before any
// company/authorization/version-token lookup.
export async function handleCarouselConfirmationRejectModal(
  ctx: PluginContext,
  interaction: ModalSubmitInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseCarouselConfirmRejectModalCustomId(interaction.customId);
  if (!parsed) return;

  try {
    await interaction.deferUpdate();
  } catch (err: any) {
    if (err?.code === 10062) {
      ctx.logger.warn("carousel-confirmation-reject-modal: interaction expired before deferUpdate (3s window)", {
        issueId: parsed.issueId,
        interactionId: parsed.interactionId,
      });
      return;
    }
    throw err;
  }

  // Everything below runs AFTER the ack — see the accept handler's matching
  // comment: the outer try/catch is defense-in-depth so an unexpected throw
  // always produces a visible followUp instead of falling through to the
  // dispatcher's console.error-only swallow (discord/slash.ts).
  try {
    const company = resolveCompany(config, interaction.guildId);
    if (!company) {
      await interaction.followUp({ content: "No company configured for this guild.", ephemeral: true });
      return;
    }

    // Re-check authorization on submit — the modal is a fresh interaction.
    const mapping = resolveUserMapping(company, interaction.user.id);
    if (!mapping) {
      await interaction.followUp({
        content:
          "You're not authorized to act on this approval. Ask an operator to add your Discord user ID to the company's userMappings.",
        ephemeral: true,
      });
      return;
    }

    const reason = interaction.fields.getTextInputValue(CAROUSEL_CONFIRM_REJECT_REASON_FIELD).trim();
    if (!reason) {
      await interaction.followUp({ content: "A rejection reason is required.", ephemeral: true });
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
      await interaction.followUp({ content: STALE_TRAILER_MESSAGE, ephemeral: true });
      return;
    }

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
    await renderAnchorResolved(interaction, "rejected", `Rejected by ${actor} at ${stamp} — ${reason}`);
  } catch (err) {
    ctx.logger.warn("carousel-confirmation-reject-modal: unexpected error after ack — surfacing to operator, not swallowing", {
      issueId: parsed.issueId,
      interactionId: parsed.interactionId,
      err: String(err),
    });
    await interaction
      .followUp({ content: `⚠️ Something went wrong handling your rejection: ${String(err).slice(0, 200)}`, ephemeral: true })
      .catch(() => {
        // Truly nothing left to do — see the accept handler's matching comment.
      });
  }
}
