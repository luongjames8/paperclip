import type { APIEmbed } from "discord.js";
import { enforceEmbedLimits, safe } from "./embeds.js";
import { stripSecrets } from "./secrets.js";

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
    if (typeof item.slug !== "string") return null;
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
