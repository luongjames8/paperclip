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

// Splits arbitrary text into <=maxLen chunks at a paragraph boundary
// (\n\n) where possible, never mid-word/mid-sentence unless a single
// paragraph itself exceeds maxLen. Unlike truncate(), nothing is dropped —
// used where the caller needs the FULL text delivered across N messages
// (e.g. postsBatch platform-copy overflow, GH #501 codex P2: a Facebook/
// GBP-style long-form post exceeding Discord's 1024-char embed field limit
// must still reach the operator in full, not silently cut).
export function chunkText(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const cut = remaining.lastIndexOf("\n\n", maxLen);
    const end = cut > 0 ? cut : maxLen;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
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
