import type { APIEmbed } from "discord.js";
import { EMBED_TOTAL_MAX, embedCharCount, enforceEmbedLimits, safe } from "./embeds.js";
import { stripSecrets } from "./secrets.js";
import { chunkText } from "./plain.js";

// Discord's per-message embed count cap — mirrors issue-docs.ts's
// EMBED_PER_MESSAGE_MAX (kept as a separate constant here rather than an
// import: issue-docs.ts's chunkEmbedsForDiscord is a GENERIC APIEmbed[] ->
// APIEmbed[][] packer shared by confirmation-sweep.ts and renderIssueDocs;
// changing its signature to carry item identity would ripple into those
// unrelated callers for no benefit. chunkPostsBatchForDiscord below
// duplicates its packing RULE only (same two limits), not its code, so a
// postsBatch embed group's originating slugs are known at the send site
// without reverse-parsing embed titles.
const EMBED_PER_MESSAGE_MAX = 10;

// ─── Structured payload contract for the weekly posts-batch approval card —
// mirrors carouselBatch's philosophy (./carousel-batch.ts): a machine-built
// field the editor assembles from the SAME structured data it already holds
// (slugs, planned days/post-times, per-platform copy, image URLs), never
// LLM-reworded prose. Detection is `payload.postsBatch?.version === 1`,
// checked BEFORE any regex/markdown parsing — a contract match never depends
// on prose shape (GH #501: the current path renders payload.proposedComment,
// a 28,887-char markdown artifact, as a raw <pre>/plaintext chunk on BOTH
// surfaces — headings, bold, and image URLs show up as literal text).
//
// The editor-side authoring change that populates this field on the approval
// (content-editor SKILL.md) is a separate follow-up — this module's degrade
// path (absent/malformed postsBatch -> existing resolveApprovalContent +
// chunkBySection plaintext render) is what keeps every already-live card
// working unchanged until that lands.
export interface PostsBatchPlatformCopy {
  threads?: string;
  x?: string;
  facebook?: string;
  gbp?: string;
}

export interface PostsBatchItem {
  slug: string;
  // Planned weekday label (e.g. "Mon") — null for an item with no fixed slot.
  day: string | null;
  // Human-readable scheduled post time (e.g. "Mon 2026-07-13 12:00 Taipei").
  postTime: string | null;
  imageUrl: string;
  hook: string;
  platforms: PostsBatchPlatformCopy;
}

export interface PostsBatchPayload {
  version: 1;
  // weekOf is OPTIONAL passthrough, same rationale as carouselBatch.weekOf —
  // only `version` and `items` are load-bearing for rendering.
  weekOf?: string;
  items: PostsBatchItem[];
}

// Runtime shape guard — payload is `Record<string, unknown>` at the API
// boundary, so a malformed or absent field must degrade to "not structured"
// rather than throw. Mirrors carousel-batch.ts's isRenderableSlideUrl: an
// imageUrl must be a parseable http(s) URL, not merely a non-empty string —
// one bad URL makes the WHOLE payload malformed (never render N-1 posts and
// silently drop the Nth), so the caller falls through to the visible
// plaintext degrade path like any other contract miss.
//
// Also rejects a URL containing any stripSecrets-matched token (codex P1):
// the plaintext degrade path always runs its content through
// stripSecrets(effectiveContent) before posting, and issue-docs.ts's sibling
// isUrlEmbeddable already rejects a URL whose value changes after secret
// stripping — this path renders straight to embed.image.url with no
// stripSecrets pass at all, so an imageUrl that happens to contain a
// secret-shaped token (accidental paste, malformed R2 path, etc.) would
// otherwise reach Discord raw.
function isRenderableImageUrl(s: unknown): boolean {
  if (typeof s !== "string") return false;
  if (stripSecrets(s) !== s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function parsePlatformCopy(raw: unknown): PostsBatchPlatformCopy {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const platforms: PostsBatchPlatformCopy = {};
  for (const key of ["threads", "x", "facebook", "gbp"] as const) {
    if (typeof obj[key] === "string" && obj[key].trim()) platforms[key] = obj[key] as string;
  }
  return platforms;
}

export function parsePostsBatchPayload(raw: unknown): PostsBatchPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;

  const weekOf = typeof obj.weekOf === "string" ? obj.weekOf : undefined;

  if (!Array.isArray(obj.items)) return null;
  const items: PostsBatchItem[] = [];
  for (const rawItem of obj.items) {
    if (!rawItem || typeof rawItem !== "object") return null;
    const item = rawItem as Record<string, unknown>;
    // Slug is bounded at the contract boundary (codex P2, round 7): an
    // unbounded slug rides into renderOverflowMessages' per-chunk header and
    // can eat the entire message budget (a ~1.9k-char slug made
    // header==budget -> bodyBudget 0 -> the chunkText infinite loop). 200
    // chars is far beyond any real slug; longer = malformed AS A WHOLE,
    // degrading to the visible fallback paths like every other contract miss.
    if (typeof item.slug !== "string" || item.slug.length === 0 || item.slug.length > 200) return null;
    if (item.day !== null && item.day !== undefined && typeof item.day !== "string") return null;
    if (item.postTime !== null && item.postTime !== undefined && typeof item.postTime !== "string") return null;
    if (!isRenderableImageUrl(item.imageUrl)) return null;
    if (typeof item.hook !== "string") return null;
    items.push({
      slug: item.slug,
      day: typeof item.day === "string" ? item.day : null,
      postTime: typeof item.postTime === "string" ? item.postTime : null,
      imageUrl: item.imageUrl as string,
      hook: item.hook,
      platforms: parsePlatformCopy(item.platforms),
    });
  }
  return {
    version: 1,
    ...(weekOf !== undefined ? { weekOf } : {}),
    items,
  };
}

const PLATFORM_LABELS: Record<keyof PostsBatchPlatformCopy, string> = {
  threads: "Threads",
  x: "X",
  facebook: "Facebook",
  gbp: "GBP",
};

// Discord's hard limit on an embed field's `value` — not a stylistic choice,
// exceeding it makes Discord reject the whole embed send.
const EMBED_FIELD_VALUE_MAX = 1024;

// A platform copy that overflows the embed field limit (codex P2: long-form
// Facebook/GBP copy silently truncated with no overflow visibility, and the
// successful structured send suppressed the plaintext proposedComment
// fallback that used to carry the full text). Caller posts these as
// plaintext follow-up messages after the embed group — mirrors carousel-
// batch's "an image is never silently dropped" philosophy for text.
export interface PostsBatchPlatformOverflow {
  itemSlug: string;
  platformLabel: string;
  fullText: string;
}

export interface RenderedPostsBatch {
  embeds: APIEmbed[];
  overflow: PostsBatchPlatformOverflow[];
}

/**
 * Render one embed per post: image + hook as the description header,
 * followed by each present platform's copy as its own field (never a
 * shared/merged blob — the operator reviews per-platform copy the same way
 * the source proposedComment markdown lays it out under ### Threads / ### X /
 * ### Facebook headings). A platform copy longer than Discord's 1024-char
 * embed field limit gets a truncated-with-marker preview in the field PLUS
 * its full text returned in `overflow` for the caller to post as a
 * plaintext follow-up — never silently cut with no trace.
 */
export function renderPostsBatchEmbeds(payload: PostsBatchPayload): RenderedPostsBatch {
  const total = payload.items.length;
  const overflow: PostsBatchPlatformOverflow[] = [];
  const embeds = payload.items.map((item, i) => {
    const headingParts = [item.day, item.postTime].filter((v): v is string => Boolean(v));
    const titleParts = [headingParts.join(" — "), item.slug].filter(Boolean);
    const fields = (Object.keys(PLATFORM_LABELS) as Array<keyof PostsBatchPlatformCopy>)
      .filter((key) => item.platforms[key])
      .map((key) => {
        const text = item.platforms[key] as string;
        const label = PLATFORM_LABELS[key];
        if (text.length > EMBED_FIELD_VALUE_MAX) {
          overflow.push({ itemSlug: item.slug, platformLabel: label, fullText: text });
          return { name: `${label} (full text below)`, value: safe(text, EMBED_FIELD_VALUE_MAX) };
        }
        return { name: label, value: safe(text, EMBED_FIELD_VALUE_MAX) };
      });
    return enforceEmbedLimits({
      title: safe(titleParts.join(" · ") || `Post ${i + 1}/${total}`, 256),
      description: safe(item.hook, 2000),
      image: { url: item.imageUrl },
      footer: { text: safe(`${i + 1}/${total}${payload.weekOf ? ` · week of ${payload.weekOf}` : ""}`, 2048) },
      fields: fields.length > 0 ? fields : undefined,
    });
  });
  return { embeds, overflow };
}

export interface PostsBatchEmbedGroup {
  embeds: APIEmbed[];
  // Slugs of the items packed into this group, in the same order as `embeds`
  // (each embed is exactly one item — renderPostsBatchEmbeds is a 1:1 map).
  // Lets a caller that fails to send this group report EXACTLY which posts
  // are missing, without reverse-parsing embed titles (title format is
  // presentation, not an identity contract).
  slugs: string[];
}

export interface ChunkedPostsBatch {
  groups: PostsBatchEmbedGroup[];
  overflow: PostsBatchPlatformOverflow[];
}

/**
 * renderPostsBatchEmbeds + Discord-message-sized packing (≤10 embeds, ≤6000
 * chars per message — same rule as issue-docs.ts's chunkEmbedsForDiscord,
 * duplicated rather than reused so item identity survives packing: see the
 * EMBED_PER_MESSAGE_MAX comment above for why the generic packer isn't
 * extended instead). Each returned group carries the slugs of the posts it
 * contains, so a caller whose send for that group fails (even after retry)
 * can name exactly which posts are missing in a partial-delivery warning —
 * the DELIVERY-COMPLETENESS invariant ("the operator must never see an
 * approvable card whose visible content is a silent subset of the batch")
 * requires per-group identity, not just a per-batch success/failure bit
 * (codex P2, round 6: a bare boolean flipped true by group 1's success hid
 * every later group's failure).
 */
export function chunkPostsBatchForDiscord(payload: PostsBatchPayload): ChunkedPostsBatch {
  const { embeds, overflow } = renderPostsBatchEmbeds(payload);
  const slugs = payload.items.map((item) => item.slug);
  const groups: PostsBatchEmbedGroup[] = [];
  let batchEmbeds: APIEmbed[] = [];
  let batchSlugs: string[] = [];
  let chars = 0;
  for (let i = 0; i < embeds.length; i++) {
    const e = embeds[i];
    const c = embedCharCount(e);
    if (
      batchEmbeds.length >= EMBED_PER_MESSAGE_MAX ||
      (batchEmbeds.length > 0 && chars + c > EMBED_TOTAL_MAX)
    ) {
      groups.push({ embeds: batchEmbeds, slugs: batchSlugs });
      batchEmbeds = [];
      batchSlugs = [];
      chars = 0;
    }
    batchEmbeds.push(e);
    batchSlugs.push(slugs[i]);
    chars += c;
  }
  if (batchEmbeds.length > 0) groups.push({ embeds: batchEmbeds, slugs: batchSlugs });
  return { groups, overflow };
}

// Plaintext message budget — matches CONTENT_CHUNK_MAX in both callers
// (approval-created.ts, approvals-reminder.ts) and postToChannel's own
// default truncate() cap (rest.ts), so a message this function returns is
// never subject to postToChannel's truncate() actually cutting anything
// (that call becomes a pure no-op safety net, never load-bearing).
const OVERFLOW_MESSAGE_MAX = 1900;

/**
 * Render a platform-copy overflow entry into one or more FINAL, ready-to-post
 * message strings — every string this returns already fits within `maxLen`
 * INCLUDING its header, so the caller's postToChannel (which itself truncates
 * to the same default) never needs to cut anything (codex P2, round 2 of this
 * finding: the previous version chunked the body to the full budget FIRST,
 * then prepended a header, which could push the total past the budget and
 * get the tail silently truncated by postToChannel).
 *
 * The header (`**slug — platform (full text N/M)**`) is reserved space on
 * EVERY chunk, not just the first — a reader landing on chunk 2 of 3 with no
 * header has no way to tell which post/platform it belongs to, which is as
 * much a "silently lost information" failure as a truncated tail.
 */
export function renderOverflowMessages(item: PostsBatchPlatformOverflow, maxLen = OVERFLOW_MESSAGE_MAX): string[] {
  const headerFor = (n: number, total: number) => `**${item.itemSlug} — ${item.platformLabel} (full text ${n}/${total})**\n`;
  // Reserve budget for up to 4-digit chunk numbering (N/M both <= 9999) —
  // ~9999 chunks at ~1900 chars/chunk is ~19M chars of single-platform copy,
  // several orders of magnitude beyond any plausible content (the entire
  // 13-post proposedComment artifact this feature replaces is 28,887 chars
  // TOTAL). Reserving for a bound this generous, rather than measuring the
  // real header after chunking, sidesteps the header-length/chunk-count
  // circular dependency (more chunks -> more digits -> longer header ->
  // fewer chunks fit -> ...) without an iterative solver for an input class
  // that will never occur.
  const maxHeaderLen = headerFor(9999, 9999).length;
  // FAIL CLOSED on a maxLen too small to even fit the reserved header — both
  // real callers pass CONTENT_CHUNK_MAX (1900), always vastly larger than
  // maxHeaderLen (tens of chars for any realistic slug/platform label), but
  // a future misuse passing a tiny maxLen must be a loud error, never a
  // silently-oversized message (the exact failure class this function
  // exists to close).
  // `<= `, not `<` (codex P2, round 7): equality leaves bodyBudget = 0,
  // which used to reach chunkText(text, 0) — an infinite loop. The body
  // budget must be at least 1 char.
  if (maxLen <= maxHeaderLen) {
    throw new Error(`renderOverflowMessages: maxLen (${maxLen}) leaves no body budget after the reserved header (${maxHeaderLen}) — cannot fit even a 1-char body`);
  }
  const bodyBudget = maxLen - maxHeaderLen;
  const bodyChunks = chunkText(item.fullText, bodyBudget);
  const total = bodyChunks.length;
  // Fail-closed backstop for the reservation bound itself: if some future
  // caller ever hands this a fullText long enough to blow past 9999 chunks,
  // the ACTUAL header for a >9999 total would be wider than reserved —
  // asserted here so a regression in either constant is loud in tests
  // rather than silently reintroducing the truncation bug this function
  // exists to close.
  if (headerFor(total, total).length > maxHeaderLen) {
    throw new Error(`renderOverflowMessages: header reservation exceeded (total=${total}) — widen the digit-width bound`);
  }
  return bodyChunks.map((body, i) => headerFor(i + 1, total) + body);
}

// Both callers pass truncate/postToChannel's default budget for this — kept
// as a local constant (not exported) since it only bounds THIS function's
// own output, unlike CONTENT_CHUNK_MAX which both call sites share across
// several message kinds.
const WARNING_MESSAGE_MAX = 1900;

/**
 * Build the loud, unsuppressable delivery-completeness warning: posted
 * whenever ANY unit (embed group or overflow message) failed to deliver even
 * after a retry, REGARDLESS of how many other units succeeded around it.
 * This is what makes the DELIVERY-COMPLETENESS invariant hold by
 * construction — the caller doesn't need to reason about which combination
 * of groups/overflow succeeded, just "is missingSlugs non-empty."
 *
 * Never suppressed by a successful plaintext fallback or vice versa: the
 * caller posts this unconditionally on any residual failure, independent of
 * whatever else it does with effectiveContent/reviewableContent.
 */
export function buildPartialDeliveryWarning(missingSlugs: string[], issueUrl: string): string {
  const n = missingSlugs.length;
  const list = safe(missingSlugs.join(", "), WARNING_MESSAGE_MAX - 200);
  return `⚠️ **${n} post group${n === 1 ? "" : "s"} failed to deliver** — missing: ${list}\nFull batch: ${issueUrl}`;
}
