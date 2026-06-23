import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig, UserMapping } from "../config/schema.js";
import { PaperclipClient } from "../api/paperclip.js";
import {
  APPROVAL_BUTTON_PREFIX,
  APPROVAL_REVISION_MODAL_PREFIX,
  APPROVAL_REVISION_NOTE_FIELD,
} from "../render/embeds.js";
import { PENDING_APPROVALS_KEY } from "./approval-created.js";

export type ApprovalAction = "approve" | "reject" | "revision";

export function parseApprovalCustomId(customId: string): { action: ApprovalAction; approvalId: string } | null {
  if (customId.startsWith(APPROVAL_BUTTON_PREFIX.approve)) {
    return { action: "approve", approvalId: customId.slice(APPROVAL_BUTTON_PREFIX.approve.length) };
  }
  if (customId.startsWith(APPROVAL_BUTTON_PREFIX.reject)) {
    return { action: "reject", approvalId: customId.slice(APPROVAL_BUTTON_PREFIX.reject.length) };
  }
  if (customId.startsWith(APPROVAL_BUTTON_PREFIX.revision)) {
    return { action: "revision", approvalId: customId.slice(APPROVAL_BUTTON_PREFIX.revision.length) };
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

  // "Request changes" opens a modal to collect the operator's revision note.
  // showModal MUST be the first response to the interaction, so this branch runs
  // BEFORE deferUpdate (which would consume the interaction token). The modal
  // submit is handled by handleApprovalRevisionModal.
  if (parsed.action === "revision") {
    const modal = new ModalBuilder()
      .setCustomId(`${APPROVAL_REVISION_MODAL_PREFIX}${parsed.approvalId}`)
      .setTitle("Request changes")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(APPROVAL_REVISION_NOTE_FIELD)
            .setLabel("What needs to change?")
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
      // 3s interaction-token window expired (commonly: button click during
      // plugin restart / deploy downtime). Discord shows "This component is
      // no longer valid" to the user. Nothing to do but return gracefully —
      // throwing here crashes the worker via unhandledRejection.
      ctx.logger.warn("approval-button: interaction expired before deferUpdate (3s window)", {
        approvalId: parsed.approvalId,
        action: parsed.action,
      });
      return;
    }
    throw err;
  }

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

  // Reject is terminal in paperclip — no auto-resubmission, no auto-respawn
  // of upstream Creative/Writer issues. Operators have repeatedly assumed
  // reject means "send back for fixes" (it does not) and burned hours
  // manually reconstructing the chain. Surface this explicitly post-reject
  // so the expectation gap closes at the moment of action.
  if (parsed.action === "reject") {
    try {
      await interaction.followUp({
        content:
          "⚠️ Rejected — **this approval is terminal**. No auto-resubmission, " +
          "no upstream work-issue is respawned. If you wanted a redo, comment " +
          "the change you need and ask the relevant agent to spawn a new work " +
          "issue (or wait for the next batch). Reject = \"delete this entirely,\" " +
          "not \"send back for fixes.\"",
        ephemeral: false,
      });
    } catch (err) {
      // Best-effort warning. If Discord rate-limits or the follow-up window
      // expires (15 min after deferUpdate), the reject still took effect —
      // we just couldn't surface the warning. Log and move on.
      ctx.logger.warn("approval-button: reject-warning followUp failed", {
        approvalId: parsed.approvalId,
        err: String(err),
      });
    }
  }
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

// Handles the "Request changes" modal submit: POSTs request-revision with the
// operator's note as decisionNote. The server then wakes the card creator
// (approval_revision_requested) to revise + resubmit the SAME card — no new card.
export async function handleApprovalRevisionModal(
  ctx: PluginContext,
  interaction: ModalSubmitInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  if (!interaction.customId.startsWith(APPROVAL_REVISION_MODAL_PREFIX)) return;
  const approvalId = interaction.customId.slice(APPROVAL_REVISION_MODAL_PREFIX.length);

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

  const note = interaction.fields.getTextInputValue(APPROVAL_REVISION_NOTE_FIELD).trim();

  await interaction.deferReply({ ephemeral: true });
  try {
    const apiKey = await ctx.secrets.resolve(
      mapping.boardApiKeySecretRef ?? company.paperclipApiKeySecretRef,
    );
    const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);
    await paperclip.requestRevisionApproval(approvalId, note);
  } catch (err) {
    ctx.logger.warn("approval-revision-modal: paperclip API call failed", {
      approvalId,
      err: String(err),
    });
    await interaction.editReply({
      content: `Failed to request changes: ${String(err).slice(0, 200)}`,
    });
    return;
  }

  await removeFromPending(ctx, company.companyId, approvalId);

  await interaction.editReply({
    content:
      "✏️ Requested changes — the card creator has been woken with your note to revise and resubmit the **same** card.",
  });
}
