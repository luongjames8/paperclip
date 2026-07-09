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
// encodes both ids: `prefix:issueId:interactionId`.
export const CAROUSEL_CONFIRM_BUTTON_PREFIX = {
  accept: "carousel-confirm-accept:",
  reject: "carousel-confirm-reject:",
} as const;

// Modal shown when the operator clicks "Reject" — customId carries BOTH ids;
// the modal collects the required rejection reason.
export const CAROUSEL_CONFIRM_REJECT_MODAL_PREFIX = "carousel-reject-modal:";
export const CAROUSEL_CONFIRM_REJECT_REASON_FIELD = "rejectReason";

// custom_id hard limit is 100 chars — verified by the runtime guard in
// buildCarouselConfirmationActionRow, which throws on overflow (longest:
// reject prefix 24 + 36 + 1 + 36 = 97).
const MAX_CUSTOM_ID_LEN = 100;

export function buildCarouselConfirmationActionRow(
  issueId: string,
  interactionId: string,
): APIActionRowComponent<APIComponentInMessageActionRow> {
  const acceptId = `${CAROUSEL_CONFIRM_BUTTON_PREFIX.accept}${issueId}:${interactionId}`;
  const rejectId = `${CAROUSEL_CONFIRM_BUTTON_PREFIX.reject}${issueId}:${interactionId}`;
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
