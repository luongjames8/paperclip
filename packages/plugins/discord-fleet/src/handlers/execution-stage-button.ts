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
): { action: ExecutionStageAction; issueId: string; stageId: string; decisionToken: string } | null {
  for (const [action, prefix] of Object.entries(EXECUTION_STAGE_BUTTON_PREFIX) as Array<
    [ExecutionStageAction, string]
  >) {
    if (!customId.startsWith(prefix)) continue;
    const [issueId, stageId, decisionToken] = customId.slice(prefix.length).split(":");
    if (!issueId || !stageId || !decisionToken) return null;
    return { action, issueId, stageId, decisionToken };
  }
  return null;
}

export function parseExecutionStageChangesModalCustomId(
  customId: string,
): { issueId: string; stageId: string; decisionToken: string } | null {
  if (!customId.startsWith(EXECUTION_STAGE_CHANGES_MODAL_PREFIX)) return null;
  const [issueId, stageId, decisionToken] = customId.slice(EXECUTION_STAGE_CHANGES_MODAL_PREFIX.length).split(":");
  if (!issueId || !stageId || !decisionToken) return null;
  return { issueId, stageId, decisionToken };
}

function resolveCompany(config: DiscordFleetConfig, guildId: string | null): CompanyConfig | undefined {
  if (!guildId) return undefined;
  return config.companies.find((c) => c.guildId === guildId);
}

function resolveUserMapping(company: CompanyConfig, discordUserId: string): UserMapping | undefined {
  return company.userMappings?.find((m) => m.discordUserId === discordUserId);
}

// Staleness guard (fleet issue #631 / PR-0, hardened across codex rounds
// 1-5): the customId's stageId + decisionToken ride along as
// expectedExecutionStageId + expectedLastDecisionToken on the PATCH itself,
// and the SERVER enforces both atomically as part of the same request that
// applies the transition (server/src/services/issue-execution-policy.ts) —
// rejecting with 409 if the stage is no longer the current pending one, OR
// if a changes-requested-then-resubmit cycle happened since this card was
// rendered (same stageId, but a fresh decisionToken — see
// executionStageDecisionToken's doc comment in embeds.ts). An earlier
// version of the stageId half of this guard did a separate client-side
// GET-then-PATCH pre-check; that left a round-trip race window (a
// double-click, or the same participant resolving a stage in the gap
// between the check and the act) that only a server-side compare-and-swap
// closes by construction.
const STALE_STAGE_MESSAGE =
  "This card is for a stage that's already been resolved, or a newer version was posted after changes were requested and resubmitted — check Paperclip for the current state.";

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

async function renderResolved(
  ctx: PluginContext,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  label: string,
): Promise<void> {
  const original = interaction.message?.embeds?.[0]?.toJSON();
  if (!original) {
    // adversarial-seam-hardening: this used to return silently — if the
    // interaction message never carried an embed snapshot, the operator got
    // no render AND no log line, indistinguishable from every other "nothing
    // happened" failure this whole seam exists to eliminate.
    ctx.logger.warn("execution-stage-button: no embed on the interaction message, outcome not rendered", { label });
    return;
  }
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

// codex round 10: a 200 from updateIssueStatus doesn't by itself prove the
// decision was recorded — a policy edit under a stale card can pass every
// pre-write check and still only reassign the stage, no decision, no error
// thrown. Shared by both handlers below (approve + request-changes) so the
// "trust the server's account, not just the status code" check lives in one
// place, mirroring describeUpdateIssueStatusError's role for the error path.
async function renderDecisionOutcome(
  ctx: PluginContext,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  result: { executionStageDecisionRecorded?: boolean },
  successLabel: string,
): Promise<void> {
  if (result.executionStageDecisionRecorded === false) {
    await interaction.followUp({ content: STALE_STAGE_MESSAGE, ephemeral: true });
    await renderResolved(ctx, interaction, "⚠️ Stage changed");
    return;
  }
  await renderResolved(ctx, interaction, successLabel);
}

// adversarial-seam-hardening (round 11, fleet issue #631): the ONE place that
// owns defer -> resolve secret -> call -> render for BOTH the approve button
// and the request-changes modal submit, so an ACKNOWLEDGED interaction can
// never end in silence regardless of which step throws. Enumerated failure
// classes this closes (codex found the first two independently; the rest
// fell out of enumerating the whole ack-to-render path):
//   - deferUpdate() throwing DiscordAPIError[10062] (expired 3s window) — the
//     button handler already caught this; the modal handler didn't.
//   - ctx.secrets.resolve() throwing (missing/renamed secret) outside any
//     try/catch — the click stayed acknowledged-but-silent.
//   - the API call itself failing (already handled pre-existing, folded in).
//   - the render step ITSELF (editReply/followUp) failing AFTER the decision
//     already succeeded server-side — previously unguarded, so a Discord-side
//     hiccup left a stale card with live buttons and no explanation, even
//     though Paperclip's state was already correct.
async function runExecutionStageDecision(
  ctx: PluginContext,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  opts: {
    issueId: string;
    stageId: string;
    decisionToken: string;
    status: string;
    comment: string;
    mapping: UserMapping;
    company: CompanyConfig;
    successLabel: string;
    verb: string;
  },
): Promise<void> {
  try {
    await interaction.deferUpdate();
  } catch (err: any) {
    if (err?.code === 10062) {
      ctx.logger.warn("execution-stage-button: interaction expired before deferUpdate (3s window)", {
        issueId: opts.issueId,
        verb: opts.verb,
      });
      return;
    }
    throw err;
  }

  let result: { executionStageDecisionRecorded?: boolean };
  try {
    const apiKey = await ctx.secrets.resolve(opts.mapping.boardApiKeySecretRef!);
    const paperclip = new PaperclipClient(ctx, opts.company.paperclipApiUrl, apiKey);
    result = await paperclip.updateIssueStatus(
      opts.issueId,
      opts.status,
      opts.comment,
      opts.stageId,
      opts.decisionToken,
    );
  } catch (err) {
    ctx.logger.warn(`execution-stage-button: ${opts.verb} failed`, { issueId: opts.issueId, err: String(err) });
    await interaction
      .followUp({ content: describeUpdateIssueStatusError(err, opts.verb), ephemeral: true })
      .catch((followUpErr) => {
        ctx.logger.error("execution-stage-button: failure follow-up ALSO failed — click is now silent", {
          issueId: opts.issueId,
          err: String(followUpErr),
        });
      });
    return;
  }

  try {
    await renderDecisionOutcome(ctx, interaction, result, opts.successLabel);
  } catch (err) {
    ctx.logger.error(
      "execution-stage-button: decision succeeded server-side but rendering the outcome failed — Paperclip is correct, the Discord card may be stale",
      { issueId: opts.issueId, err: String(err) },
    );
    await interaction
      .followUp({
        content: `${opts.successLabel.replace(/^[⚠️✅✏️]\s*/u, "")} — but I couldn't update the card. Check Paperclip to confirm.`,
        ephemeral: true,
      })
      .catch(() => {
        // best-effort last resort — nothing further to surface the failure with.
      });
  }
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
      .setCustomId(`${EXECUTION_STAGE_CHANGES_MODAL_PREFIX}${parsed.issueId}:${parsed.stageId}:${parsed.decisionToken}`)
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

  await runExecutionStageDecision(ctx, interaction, {
    issueId: parsed.issueId,
    stageId: parsed.stageId,
    decisionToken: parsed.decisionToken,
    status: "done",
    comment: `Approved via Discord by ${interaction.user.username}`,
    mapping,
    company,
    successLabel: "✅ Approved",
    verb: "approve",
  });
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
  const { issueId, stageId, decisionToken } = parsed;

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

  await runExecutionStageDecision(ctx, interaction, {
    issueId,
    stageId,
    decisionToken,
    status: "in_progress",
    comment: note,
    mapping,
    company,
    successLabel: "✏️ Changes requested",
    verb: "request changes",
  });
}
