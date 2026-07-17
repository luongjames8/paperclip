import type { APIActionRowComponent, APIButtonComponent, APIEmbed, APIComponentInMessageActionRow } from "discord.js";
import { ButtonStyle, ComponentType } from "discord.js";
import { stripSecrets } from "./secrets.js";
import { truncate } from "./plain.js";

export const APPROVAL_BUTTON_PREFIX = {
  approve: "approval-approve:",
  reject: "approval-reject:",
  revision: "approval-revision:",
} as const;

// Modal shown when the operator clicks "Request changes" — customId carries the
// approval id; the modal collects the revision note (-> decisionNote).
export const APPROVAL_REVISION_MODAL_PREFIX = "approval-revision-modal:";
export const APPROVAL_REVISION_NOTE_FIELD = "revisionNote";

// Carousel-batch confirmation buttons — a DIFFERENT entity (issue_thread_interactions)
// from approvals, so these NEVER reuse the approval-* prefixes above. customId
// encodes a version token + both ids: `prefix:hash8:issueId:interactionId`. The
// hash8 (first 8 hex chars of the posted artifact's sha256) is what lets the
// click-time handler detect a STALE trailer — see FIX (a) in PR #27 codex round 3.
export const CAROUSEL_CONFIRM_BUTTON_PREFIX = {
  accept: "car-ok:",
  reject: "car-no:",
} as const;

// OLD (pre-versioning) prefixes. May still exist on already-posted Discord
// messages after a deploy that ships this change. They carry no hash token,
// so a click on one is UNVERIFIABLE — routed to the same stale-refusal path
// as a hash mismatch, never accepted/rejected directly. Never remove without
// checking no live trailer still carries one.
export const CAROUSEL_CONFIRM_BUTTON_PREFIX_LEGACY = {
  accept: "carousel-confirm-accept:",
  reject: "carousel-confirm-reject:",
} as const;

// Modal shown when the operator clicks "Reject" — customId carries the hash8
// token + BOTH ids; the modal collects the required rejection reason.
export const CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX = "car-rjm:";
// OLD (pre-versioning) reject-modal prefix — same legacy handling as above.
export const CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX_LEGACY = "carousel-reject-modal:";
export const CAROUSEL_CONFIRM_REJECT_REASON_FIELD = "rejectReason";

// Length of the version token embedded in every new-format customId (first N
// hex chars of the artifact's sha256).
export const CAROUSEL_HASH_TOKEN_LEN = 8;

// custom_id hard limit is 100 chars — verified by the runtime guard in
// buildCarouselConfirmationActionRow, which throws on overflow (longest:
// reject prefix 7 + hash8 8 + 1 + 36 + 1 + 36 = 89).
const MAX_CUSTOM_ID_LEN = 100;

// Single source for the accept-button customId — the confirmation-sweep's
// adopt-don't-duplicate probe matches messages by this EXACT string, so it
// must never be re-derived by a second interpolation that could drift.
export function carouselConfirmAcceptCustomId(issueId: string, interactionId: string, hash8: string): string {
  return `${CAROUSEL_CONFIRM_BUTTON_PREFIX.accept}${hash8}:${issueId}:${interactionId}`;
}

export function buildCarouselConfirmationActionRow(
  issueId: string,
  interactionId: string,
  hash8: string,
): APIActionRowComponent<APIComponentInMessageActionRow> {
  const acceptId = carouselConfirmAcceptCustomId(issueId, interactionId, hash8);
  const rejectId = `${CAROUSEL_CONFIRM_BUTTON_PREFIX.reject}${hash8}:${issueId}:${interactionId}`;
  if (acceptId.length > MAX_CUSTOM_ID_LEN || rejectId.length > MAX_CUSTOM_ID_LEN) {
    throw new Error(
      `carousel confirmation custom_id exceeds Discord's ${MAX_CUSTOM_ID_LEN}-char limit (accept=${acceptId.length}, reject=${rejectId.length})`,
    );
  }
  const accept: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Success,
    label: "✅ Accept",
    custom_id: acceptId,
  };
  const reject: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Danger,
    label: "❌ Reject",
    custom_id: rejectId,
  };
  return {
    type: ComponentType.ActionRow,
    components: [accept, reject],
  };
}

// Carousel-batch anchor statuses — the trailer/anchor message is EDITED in
// place across every one of these, never re-posted (kills the "stacked
// generations" confusion: 2026-07-11 live incident, partial + full renders of
// the same week both sitting in the channel with nothing marking which was
// current).
export type CarouselAnchorStatus = "awaiting" | "accepted" | "rejected" | "cancelled" | "superseded" | "expired";

const CAROUSEL_ANCHOR_STATUS_LINE: Record<CarouselAnchorStatus, string> = {
  awaiting: "🟡 awaiting decision",
  accepted: "✅ accepted",
  rejected: "❌ rejected",
  cancelled: "🚫 cancelled",
  superseded: "⏰ superseded — a newer version was posted below",
  expired: "⏰ expired — no decision was made in time",
};

// Anchor embed title is a function of status — the operator scanning a
// channel full of carousel-batch cards must be able to tell decided from
// pending from expired WITHOUT opening each one (a hardcoded "Decision
// needed" title regardless of status was itself a contract wobble: an
// accepted/rejected/expired card kept showing "Decision needed" forever).
const CAROUSEL_ANCHOR_TITLE: Record<CarouselAnchorStatus, string> = {
  awaiting: "Decision needed",
  accepted: "Decision: accepted",
  rejected: "Decision: rejected",
  cancelled: "Cancelled",
  superseded: "Superseded",
  expired: "Expired — no decision in time",
};

// Builds the anchor embed body (status line + optional actor/reason detail).
// Callers attach the action row (buildCarouselConfirmationActionRow) only
// while status is "awaiting" — every other status strips components.
export function buildCarouselAnchorEmbed(opts: {
  issueUrl: string;
  status: CarouselAnchorStatus;
  detail?: string;
}): APIEmbed {
  const statusLine = CAROUSEL_ANCHOR_STATUS_LINE[opts.status];
  const lines = [statusLine, opts.detail ? safe(opts.detail, 1000) : null, `[View full batch in Paperclip](${opts.issueUrl})`].filter(
    (l): l is string => Boolean(l),
  );
  const color =
    opts.status === "accepted"
      ? 0x57f287
      : opts.status === "rejected"
        ? 0xed4245
        : opts.status === "awaiting"
          ? 0x5865f2
          : 0x99aab5;
  return enforceEmbedLimits({
    color,
    title: CAROUSEL_ANCHOR_TITLE[opts.status],
    description: lines.join("\n"),
  });
}

// Execution-policy review/approval stage cards (fleet issue #631 / PR-0) — a
// DIFFERENT entity from approvals (issues.executionState, not the approvals
// table). customId carries issueId + stageId + a decision-generation token:
// PATCH /api/issues/{id} enforces both atomically, server-side, as a
// compare-and-swap (issue-execution-policy.ts) before acting on WHATEVER
// stage is currently pending. Two staleness classes this guards, both
// hardened across codex review rounds:
//   - stageId: a participant assigned to TWO consecutive stages of the same
//     issue (reviewer == approver, a normal config) could otherwise click a
//     stale, already-superseded card and silently resolve the wrong stage.
//   - decision token: a changes-requested-then-resubmit cycle returns to the
//     SAME stageId with status back to "pending" — stageId alone can't tell
//     a card from BEFORE that cycle from the fresh resubmission. The token is
//     the first EXECUTION_STAGE_DECISION_TOKEN_LEN hex chars of
//     executionState.lastDecisionId (or the literal sentinel below when no
//     decision has ever been recorded yet), which the server stamps to a
//     fresh value every time ANY decision is recorded for the issue — see
//     executionStageDecisionToken in server/src/services/issue-execution-policy.ts
//     (the two sides must agree on this convention independently; there's no
//     shared package between the server and this plugin to import it from).
export const EXECUTION_STAGE_BUTTON_PREFIX = {
  approve: "exs-ok:",
  changes: "exs-chg:",
} as const;

// Modal shown when the operator clicks "Request changes" — the runtime
// requires a comment on every stage decision (issue-execution-policy.ts,
// "Requesting changes requires a comment").
export const EXECUTION_STAGE_CHANGES_MODAL_PREFIX = "exs-chgm:";
export const EXECUTION_STAGE_CHANGES_NOTE_FIELD = "changesNote";

// Mirrors server/src/services/issue-execution-policy.ts's
// EXECUTION_STAGE_DECISION_TOKEN_LEN / EXECUTION_STAGE_NO_DECISION_TOKEN.
export const EXECUTION_STAGE_DECISION_TOKEN_LEN = 8;
export const EXECUTION_STAGE_NO_DECISION_TOKEN = "none";

export function executionStageDecisionToken(lastDecisionId: string | null | undefined): string {
  return lastDecisionId
    ? lastDecisionId.slice(0, EXECUTION_STAGE_DECISION_TOKEN_LEN)
    : EXECUTION_STAGE_NO_DECISION_TOKEN;
}

// custom_id hard limit is 100 chars. Longest: modal prefix 9 + issueId 36 +
// 1 + stageId 36 + 1 + token 8 = 91.
const EXECUTION_STAGE_MAX_CUSTOM_ID_LEN = 100;

export function buildExecutionStageActionRow(opts: {
  issueId: string;
  stageId: string;
  lastDecisionId: string | null | undefined;
  issueUrl: string;
}): APIActionRowComponent<APIComponentInMessageActionRow> {
  const suffix = `${opts.issueId}:${opts.stageId}:${executionStageDecisionToken(opts.lastDecisionId)}`;
  const approveId = `${EXECUTION_STAGE_BUTTON_PREFIX.approve}${suffix}`;
  const changesId = `${EXECUTION_STAGE_BUTTON_PREFIX.changes}${suffix}`;
  if (approveId.length > EXECUTION_STAGE_MAX_CUSTOM_ID_LEN || changesId.length > EXECUTION_STAGE_MAX_CUSTOM_ID_LEN) {
    throw new Error(
      `execution-stage custom_id exceeds Discord's ${EXECUTION_STAGE_MAX_CUSTOM_ID_LEN}-char limit (approve=${approveId.length}, changes=${changesId.length})`,
    );
  }
  const approve: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Success,
    label: "✅ Approve",
    custom_id: approveId,
  };
  const changes: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Primary,
    label: "✏️ Request changes",
    custom_id: changesId,
  };
  const view: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: "View",
    url: opts.issueUrl,
  };
  return {
    type: ComponentType.ActionRow,
    components: [approve, changes, view],
  };
}

export function buildExecutionStagePendingEmbed(opts: {
  identifier: string;
  title?: string;
  stageType: "review" | "approval";
  issueUrl: string;
}): APIEmbed {
  const headline = opts.title ? safe(opts.title, 220) : `${opts.identifier} — needs ${opts.stageType}`;
  const verb = opts.stageType === "approval" ? "Approval" : "Review";
  return enforceEmbedLimits({
    color: 0xfee75c,
    title: safe(`🟡 ${verb} needed — ${headline}`, 256),
    url: opts.issueUrl,
    description: safe(`**${opts.identifier}**\n\n[View & decide in Paperclip](${opts.issueUrl})`),
    timestamp: new Date().toISOString(),
  });
}

export function buildApprovalActionRow(opts: {
  approvalId: string;
  issueUrl: string;
}): APIActionRowComponent<APIComponentInMessageActionRow> {
  const approve: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Success,
    label: "✅ Approve",
    custom_id: `${APPROVAL_BUTTON_PREFIX.approve}${opts.approvalId}`,
  };
  const reject: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Danger,
    label: "❌ Reject",
    custom_id: `${APPROVAL_BUTTON_PREFIX.reject}${opts.approvalId}`,
  };
  const revision: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Primary,
    label: "✏️ Request changes",
    custom_id: `${APPROVAL_BUTTON_PREFIX.revision}${opts.approvalId}`,
  };
  const view: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: "View",
    url: opts.issueUrl,
  };
  return {
    type: ComponentType.ActionRow,
    components: [approve, reject, revision, view],
  };
}

export function safe(text: string, max = 1900): string {
  return stripSecrets(truncate(text, max));
}

export const EMBED_TOTAL_MAX = 6000;
const DESC_MAX = 4096;
const TITLE_MAX = 256;
const FOOTER_MAX = 2048;

export function embedCharCount(e: APIEmbed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.footer?.text?.length ?? 0) +
    (e.author?.name?.length ?? 0) +
    (e.fields ?? []).reduce(
      (sum, f) => sum + (f.name?.length ?? 0) + (f.value?.length ?? 0),
      0,
    )
  );
}

export function enforceEmbedLimits(embed: APIEmbed): APIEmbed {
  const title = embed.title ? embed.title.slice(0, TITLE_MAX) : embed.title;
  let description = embed.description;
  // Clamp footer to its per-field limit first (Discord caps at 2048). Otherwise
  // a writer-supplied long slug/theme could blow either the per-footer or the
  // total embed limit and Discord would reject the entire message.
  const footer = embed.footer
    ? { ...embed.footer, text: embed.footer.text.slice(0, FOOTER_MAX) }
    : embed.footer;

  const titleLen = title?.length ?? 0;
  const footerLen = footer?.text?.length ?? 0;
  const authorLen = embed.author?.name?.length ?? 0;
  const fieldsLen = (embed.fields ?? []).reduce((sum, f) => sum + (f.name?.length ?? 0) + (f.value?.length ?? 0), 0);
  const descAllowed = EMBED_TOTAL_MAX - titleLen - footerLen - authorLen - fieldsLen;

  if (description && description.length > Math.min(DESC_MAX, descAllowed)) {
    const cap = Math.min(DESC_MAX, descAllowed) - 1;
    description = cap > 0 ? description.slice(0, cap) + "…" : "…";
  }

  return { ...embed, title, description, footer };
}

export function buildSeedIssueEmbed(opts: {
  identifier: string;
  title: string;
  assignee?: string;
  projectName?: string;
  issueUrl: string;
}): APIEmbed {
  return enforceEmbedLimits({
    color: 0x5865f2,
    title: safe(`🌱 ${opts.identifier} — ${opts.title}`, 256),
    description: safe([opts.projectName && `**Project**: ${opts.projectName}`, opts.assignee && `**Assignee**: ${opts.assignee}`, `[View in Paperclip](${opts.issueUrl})`].filter(Boolean).join("\n")),
    timestamp: new Date().toISOString(),
  });
}

export function buildBlockedEmbed(opts: {
  identifier: string;
  title: string;
  reason?: string;
  issueUrl: string;
}): APIEmbed {
  return enforceEmbedLimits({
    color: 0xed4245,
    title: safe(`⛔ ${opts.identifier} → blocked`, 256),
    description: safe([opts.reason && `**Reason**: ${opts.reason}`, `[View in Paperclip](${opts.issueUrl})`].filter(Boolean).join("\n")),
    timestamp: new Date().toISOString(),
  });
}

export function buildApprovalEmbed(opts: {
  identifier: string;
  approvalId: string;
  approvalType: string;
  title?: string;
  issueUrl: string;
}): APIEmbed {
  const shortId = opts.approvalId.slice(0, 8);
  const headline = opts.title ? safe(opts.title, 220) : `${opts.identifier} — needs approval`;
  return enforceEmbedLimits({
    color: 0xfee75c,
    title: safe(`🟡 ${headline}`, 256),
    url: opts.issueUrl,
    description: safe(`**Type**: ${opts.approvalType}\n**ID**: ${shortId}...\n\n[View & Approve in Paperclip](${opts.issueUrl})`),
    timestamp: new Date().toISOString(),
  });
}

export function buildApprovalReminderEmbed(opts: {
  approvalId: string;
  approvalType: string;
  title?: string;
  issueUrl: string;
  ageHours: number;
  now?: Date;
}): APIEmbed {
  const shortId = opts.approvalId.slice(0, 8);
  const headline = opts.title ? safe(opts.title, 200) : `Approval ${shortId}`;
  return enforceEmbedLimits({
    color: 0xffa500,
    title: safe(`\u23f0 Still pending (${opts.ageHours}h): ${headline}`, 256),
    url: opts.issueUrl,
    description: safe(`**Type**: ${opts.approvalType}\n**ID**: ${shortId}...\n\n[View & Approve in Paperclip](${opts.issueUrl})\n\nThis approval is still waiting on a decision \u2014 reminders repeat until it is decided.`),
    timestamp: new Date().toISOString(),
  });
}

export function buildStuckIssueEmbed(opts: {
  identifier: string;
  title: string;
  hoursStuck: number;
  assignee?: string;
  issueUrl: string;
}): APIEmbed {
  return enforceEmbedLimits({
    color: 0xffa500,
    title: safe(`⚠️ Stuck: ${opts.identifier}`, 256),
    description: safe([`**In progress for**: ${opts.hoursStuck}h`, opts.assignee && `**Assignee**: ${opts.assignee}`, `> ${opts.title.slice(0, 80)}`, `[View in Paperclip](${opts.issueUrl})`].filter(Boolean).join("\n")),
    timestamp: new Date().toISOString(),
  });
}

export function buildRoutineHealthEmbed(opts: {
  routineName: string;
  /** The scheduler's own nextRunAt that was missed; null when misconfigured. */
  missedAt: Date | null;
  misconfigured: boolean;
  /** Optional replacement description for the misconfigured variant. */
  detail?: string;
}): APIEmbed {
  if (opts.misconfigured) {
    return enforceEmbedLimits({
      color: 0xff0000,
      title: safe(`⚠️ Routine misconfigured: ${opts.routineName}`, 256),
      description: safe(opts.detail ?? "Enabled schedule trigger has no valid nextRunAt — scheduler cannot plan the next run."),
      timestamp: new Date().toISOString(),
    });
  }
  const overdue = opts.missedAt ? Math.round((Date.now() - opts.missedAt.getTime()) / 3600_000) : 0;
  return enforceEmbedLimits({
    color: 0xffa500,
    title: safe(`⚠️ Routine missed: ${opts.routineName}`, 256),
    description: safe([
      `Planned fire: ${opts.missedAt ? opts.missedAt.toISOString() : "unknown"}`,
      `Overdue by: ~${overdue}h`,
    ].join("\n")),
    timestamp: new Date().toISOString(),
  });
}

export function buildRoutineRunFailedEmbed(opts: {
  routineName: string;
  runId: string;
  failureReason?: string | null;
}): APIEmbed {
  return enforceEmbedLimits({
    color: 0xff0000,
    title: safe(`⚠️ Routine run failed: ${opts.routineName}`, 256),
    description: safe(
      [`Run \`${opts.runId}\` ended \`failed\`.`, opts.failureReason ? `Reason: ${opts.failureReason}` : null]
        .filter(Boolean)
        .join("\n"),
    ),
    timestamp: new Date().toISOString(),
  });
}
