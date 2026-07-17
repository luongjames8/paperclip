import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { CompanyConfig, DiscordFleetConfig, UserMapping } from "../config/schema.js";
import { PaperclipClient, PaperclipApiError } from "../api/paperclip.js";
import {
  EXECUTION_STAGE_BUTTON_PREFIX,
  EXECUTION_STAGE_CHANGES_MODAL_PREFIX,
  EXECUTION_STAGE_CHANGES_NOTE_FIELD,
} from "../render/embeds.js";

export type ExecutionStageAction = "approve" | "changes";

export function parseExecutionStageCustomId(
  customId: string,
): { action: ExecutionStageAction; issueId: string; stageId: string } | null {
  for (const [action, prefix] of Object.entries(EXECUTION_STAGE_BUTTON_PREFIX) as Array<
    [ExecutionStageAction, string]
  >) {
    if (!customId.startsWith(prefix)) continue;
    const [issueId, stageId] = customId.slice(prefix.length).split(":");
    if (!issueId || !stageId) return null;
    return { action, issueId, stageId };
  }
  return null;
}

export function parseExecutionStageChangesModalCustomId(
  customId: string,
): { issueId: string; stageId: string } | null {
  if (!customId.startsWith(EXECUTION_STAGE_CHANGES_MODAL_PREFIX)) return null;
  const [issueId, stageId] = customId.slice(EXECUTION_STAGE_CHANGES_MODAL_PREFIX.length).split(":");
  if (!issueId || !stageId) return null;
  return { issueId, stageId };
}

function resolveCompany(config: DiscordFleetConfig, guildId: string | null): CompanyConfig | undefined {
  if (!guildId) return undefined;
  return config.companies.find((c) => c.guildId === guildId);
}

function resolveUserMapping(company: CompanyConfig, discordUserId: string): UserMapping | undefined {
  return company.userMappings?.find((m) => m.discordUserId === discordUserId);
}

// Staleness guard (fleet issue #631 / PR-0, hardened across codex rounds 1-3):
// the customId's stageId rides along as expectedExecutionStageId on the PATCH
// itself, and the SERVER enforces it atomically as part of the same request
// that applies the transition (server/src/services/issue-execution-policy.ts)
// — rejecting with 409 if the stage is no longer the current pending one.
// An earlier version of this guard did a separate client-side GET-then-PATCH
// pre-check; that left a round-trip race window (a double-click, or the same
// participant resolving a stage in the gap between the check and the act)
// that only a server-side compare-and-swap closes by construction.
const STALE_STAGE_MESSAGE =
  "This card is for a stage that's already been resolved, had changes requested, or been superseded by a later one — check Paperclip for the current state.";

// codex P2: unlike approvals (approval-button.ts), an executionPolicy stage
// transition only advances when the request actor's identity EXACTLY matches
// the stage's currentParticipant (principalsEqual in issue-execution-policy.ts)
// — there's no "any authorized board user" fallback. Falling back to the
// company-wide key when a mapping has no personal boardApiKeySecretRef would
// authenticate as a DIFFERENT board identity than the assigned participant,
// so the engine would reject the transition with an opaque 422 the operator
// can't act on. Fail closed with a clear, actionable message instead.
const NO_PERSONAL_KEY_MESSAGE =
  "Your Discord mapping needs a personal boardApiKeySecretRef to act on execution-policy stages — the runtime checks exact participant identity, and the company-wide key would authenticate as a different Paperclip user. Ask an operator to configure one for you.";

// Maps an updateIssueStatus failure to the message shown to the clicker. 409
// is the server's compare-and-swap rejection (stale stage) — a DIFFERENT,
// user-facing-friendlier message than the generic 422 "not your turn"/policy-
// validation case, so the operator isn't left staring at a raw server string
// for the one failure mode this handler specifically guards against.
function describeUpdateIssueStatusError(err: unknown, verb: string): string {
  if (err instanceof PaperclipApiError) {
    if (err.status === 409) return STALE_STAGE_MESSAGE;
    if (err.status === 422) return `Rejected by server: ${String(err).slice(0, 200)}`;
  }
  return `Failed to ${verb}: ${String(err).slice(0, 200)}`;
}

async function renderResolved(interaction: ButtonInteraction | ModalSubmitInteraction, label: string): Promise<void> {
  const original = interaction.message?.embeds?.[0]?.toJSON();
  if (!original) return;
  const stamp = new Date().toISOString();
  await interaction.editReply({
    embeds: [
      {
        ...original,
        color: 0x99aab5,
        title: `${label} — ${(original.title ?? "execution stage").replace(/^[🟡🔴🟢✅❌]\s*/u, "")}`,
        footer: { text: `${label} at ${stamp}` },
      },
    ],
    components: [],
  });
}

// Approve: PATCH {status:"done", expectedExecutionStageId}. The server's
// compare-and-swap guard (see the STALE_STAGE_MESSAGE comment above) is a
// SEPARATE, complementary check from the engine's participant-identity
// authorization — one decides whether THIS actor may act at all, the other
// whether the stage they're acting on is still the live one.
export async function handleExecutionStageButton(
  ctx: PluginContext,
  interaction: ButtonInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseExecutionStageCustomId(interaction.customId);
  if (!parsed) return;

  const company = resolveCompany(config, interaction.guildId);
  if (!company) {
    await interaction.reply({ content: "No company configured for this guild.", ephemeral: true });
    return;
  }

  const mapping = resolveUserMapping(company, interaction.user.id);
  if (!mapping) {
    await interaction.reply({
      content:
        "You're not authorized to act on this review/approval. Ask an operator to add your Discord user ID to the company's userMappings.",
      ephemeral: true,
    });
    return;
  }
  if (!mapping.boardApiKeySecretRef) {
    await interaction.reply({ content: NO_PERSONAL_KEY_MESSAGE, ephemeral: true });
    return;
  }

  // "Request changes" opens a modal to collect the required comment — showModal
  // MUST be the interaction's first response, before any deferUpdate/API call.
  // Mirrors carousel-confirmation-button.ts's reject flow exactly.
  if (parsed.action === "changes") {
    const modal = new ModalBuilder()
      .setCustomId(`${EXECUTION_STAGE_CHANGES_MODAL_PREFIX}${parsed.issueId}:${parsed.stageId}`)
      .setTitle("Request changes")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(EXECUTION_STAGE_CHANGES_NOTE_FIELD)
            .setLabel("What needs to change?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1500),
        ),
      );
    try {
      await interaction.showModal(modal);
    } catch (err: any) {
      if (err?.code === 10062) {
        ctx.logger.warn("execution-stage-button: interaction expired before showModal (3s window)", { issueId: parsed.issueId });
        return;
      }
      throw err;
    }
    return;
  }

  try {
    await interaction.deferUpdate();
  } catch (err: any) {
    if (err?.code === 10062) {
      ctx.logger.warn("execution-stage-button: interaction expired before deferUpdate (3s window)", {
        issueId: parsed.issueId,
        action: parsed.action,
      });
      return;
    }
    throw err;
  }

  const apiKey = await ctx.secrets.resolve(mapping.boardApiKeySecretRef);
  const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);

  const comment = `Approved via Discord by ${interaction.user.username}`;
  try {
    await paperclip.updateIssueStatus(parsed.issueId, "done", comment, parsed.stageId);
  } catch (err) {
    ctx.logger.warn("execution-stage-button: approve API call failed", { issueId: parsed.issueId, err: String(err) });
    await interaction.followUp({ content: describeUpdateIssueStatusError(err, "approve"), ephemeral: true });
    return;
  }

  await renderResolved(interaction, "✅ Approved");
}

// Handles the "Request changes" modal submit: PATCH {status:"in_progress",
// comment}. The runtime reassigns the issue back to its executor and returns
// this same stage to review once the executor resubmits.
export async function handleExecutionStageChangesModal(
  ctx: PluginContext,
  interaction: ModalSubmitInteraction,
  config: DiscordFleetConfig,
): Promise<void> {
  const parsed = parseExecutionStageChangesModalCustomId(interaction.customId);
  if (!parsed) return;
  const { issueId, stageId } = parsed;

  const company = resolveCompany(config, interaction.guildId);
  if (!company) {
    await interaction.reply({ content: "No company configured for this guild.", ephemeral: true });
    return;
  }

  const mapping = resolveUserMapping(company, interaction.user.id);
  if (!mapping) {
    await interaction.reply({
      content:
        "You're not authorized to act on this review/approval. Ask an operator to add your Discord user ID to the company's userMappings.",
      ephemeral: true,
    });
    return;
  }
  if (!mapping.boardApiKeySecretRef) {
    await interaction.reply({ content: NO_PERSONAL_KEY_MESSAGE, ephemeral: true });
    return;
  }

  const note = interaction.fields.getTextInputValue(EXECUTION_STAGE_CHANGES_NOTE_FIELD).trim();
  if (!note) {
    await interaction.reply({ content: "A note describing the needed changes is required.", ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  const apiKey = await ctx.secrets.resolve(mapping.boardApiKeySecretRef);
  const paperclip = new PaperclipClient(ctx, company.paperclipApiUrl, apiKey);

  try {
    await paperclip.updateIssueStatus(issueId, "in_progress", note, stageId);
  } catch (err) {
    ctx.logger.warn("execution-stage-changes-modal: request-changes API call failed", { issueId, err: String(err) });
    await interaction.followUp({ content: describeUpdateIssueStatusError(err, "request changes"), ephemeral: true });
    return;
  }

  await renderResolved(interaction, "✏️ Changes requested");
}
