import { stripSecrets } from "./secrets.js";

const STATUS_EMOJI: Record<string, string> = {
  in_progress: "🔵",
  done: "✅",
  blocked: "⛔",
  cancelled: "🚫",
  todo: "📋",
};

export function statusEmoji(status: string): string {
  return STATUS_EMOJI[status] ?? "🔄";
}

export function truncate(text: string, maxLen = 1900, trailingUrl?: string): string {
  if (text.length <= maxLen) return text;
  if (!trailingUrl) return text.slice(0, maxLen - 1) + "…";
  const suffix = `… ${trailingUrl}`;
  const available = maxLen - suffix.length;
  return (available > 0 ? text.slice(0, available) : "") + suffix;
}

export function formatChildIssueCreated(identifier: string, title: string, assignee?: string): string {
  const who = assignee ? `→ ${assignee}` : "";
  return stripSecrets(truncate(`🔵 \`${identifier}\` ${who} — ${title.slice(0, 50)}`));
}

export function formatIssueUpdated(identifier: string, status: string, reason?: string): string {
  const emoji = statusEmoji(status);
  const suffix = reason ? ` — ${reason.slice(0, 80)}` : "";
  return stripSecrets(truncate(`${emoji} \`${identifier}\` → ${status}${suffix}`));
}

export function formatStuckAlert(identifier: string, title: string, hoursStuck: number, issueUrl: string): string {
  return stripSecrets(
    truncate(`⚠️ **Stuck issue**: \`${identifier}\` has been \`in_progress\` for ${hoursStuck}h\n> ${title.slice(0, 80)}\n${issueUrl}`),
  );
}
