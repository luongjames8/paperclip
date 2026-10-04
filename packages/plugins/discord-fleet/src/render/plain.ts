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
//
// INVARIANT (adversarially tested — see render.spec.ts and
// posts-batch-parser.spec.ts's renderOverflowMessages coverage): for EVERY
// input at EVERY maxLen, (1) chunks.join("") === text (nothing lost) and
// (2) every chunk.length <= maxLen (callers budget messages against this).
// Splitting at a "\n\n" boundary must keep the separator ON the chunk that
// PRECEDES it — attaching it to the chunk boundary text lookup itself
// (lastIndexOf("\n\n", maxLen) can return an index up to maxLen, so
// including the 2-char separator in that same chunk could make it
// maxLen+2 long) would break invariant (2); dropping it (the original bug)
// breaks invariant (1). Splitting exactly AT the paragraph break — the
// preceding chunk ends right before "\n\n" (never exceeds maxLen since cut
// <= maxLen), the "\n\n" itself opens the next chunk — satisfies both.
export function chunkText(text: string, maxLen = 1900): string[] {
  // A non-positive maxLen cannot make progress: lastIndexOf("\n\n", 0)
  // misses, end = 0, slice(0) leaves `remaining` unchanged — an INFINITE
  // LOOP (codex P2, posts-batch round 7: a computed bodyBudget of 0 reached
  // this exact state). Throw loudly instead — every caller computes its
  // budget and must fail closed, never spin.
  if (maxLen < 1) {
    throw new Error(`chunkText: maxLen must be >= 1, got ${maxLen}`);
  }
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const cut = remaining.lastIndexOf("\n\n", maxLen);
    const end = cut > 0 ? cut : maxLen;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
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
