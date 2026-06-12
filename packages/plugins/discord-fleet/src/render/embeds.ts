import type { APIActionRowComponent, APIButtonComponent, APIEmbed, APIComponentInMessageActionRow } from "discord.js";
import { ButtonStyle, ComponentType } from "discord.js";
import { stripSecrets } from "./secrets.js";
import { truncate } from "./plain.js";

export const APPROVAL_BUTTON_PREFIX = {
  approve: "approval-approve:",
  reject: "approval-reject:",
} as const;

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
  const view: APIButtonComponent = {
    type: ComponentType.Button,
    style: ButtonStyle.Link,
    label: "View",
    url: opts.issueUrl,
  };
  return {
    type: ComponentType.ActionRow,
    components: [approve, reject, view],
  };
}

function safe(text: string, max = 1900): string {
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
  expectedLastFire: Date;
  actualLastFire: Date | null;
}): APIEmbed {
  const overdue = Math.round((Date.now() - (opts.expectedLastFire?.getTime() ?? 0)) / 3600_000);
  return enforceEmbedLimits({
    color: 0xffa500,
    title: safe(`⚠️ Routine missed: ${opts.routineName}`, 256),
    description: safe([`Expected last fire: ${opts.expectedLastFire.toISOString()}`, opts.actualLastFire ? `Actual last fire: ${opts.actualLastFire.toISOString()}` : "Never fired", `Overdue by: ~${overdue}h`].join("\n")),
    timestamp: new Date().toISOString(),
  });
}
