import type { APIEmbed } from "discord.js";
import { enforceEmbedLimits, safe } from "./embeds.js";

// NOTE: renderSlidesDoc in ./issue-docs.ts renders the SAME artifact kind
// (carousel slides) for the request_board_approval flow from a JSON slides
// doc. If the carousel gate ever migrates entity types again, both surfaces
// must move together — that migration silently dropping the renderer is
// exactly the historical failure this file exists to fix (see PR #27 body).

// ─── Structured payload contract (kills the "regex-on-LLM-prose" failure
// class — 2026-07-11 live incident: the publisher wrote `## akihabara (Sat)`
// instead of the documented `**1. akihabara (Sat)**`, SECTION_HEADING_RE
// missed it, and the sweep fell through to the generic path which strips
// ALL image lines — operator got zero slides, zero buttons) ─────────────────
//
// The publisher-side authoring skill (post-to-instagram-carousel/SKILL.md)
// writes this machine-consumed field ALONGSIDE detailsMarkdown when it opens
// the request_confirmation interaction. It is NEVER reworded/paraphrased by
// an LLM — it is built directly from the same structured data the publisher
// already holds (slugs, planned days, caption text, R2 slide URLs). Detection
// is `payload.carouselBatch?.version === 1`, checked BEFORE any regex — a
// contract match never depends on prose shape.
export interface CarouselBatchItem {
  slug: string;
  // Planned weekday label (e.g. "Sat") — null when the item is an unplanned
  // "stray" (published outside the week's normal cadence).
  day: string | null;
  caption: string;
  // Ordered R2 slide URLs — index 0 renders first.
  slides: string[];
}

export interface CarouselBatchCadence {
  days: string[];
  held: number;
  strays: number;
  // Oldest week-of a held item originated from, when any items are held over
  // from a prior week's batch. Absent when nothing is held.
  heldOldestWeek?: string;
}

export interface CarouselBatchPayload {
  version: 1;
  // weekOf/cadence are OPTIONAL passthrough — the contract's job is to make
  // sure the operator ALWAYS sees the batch (never a blind fallthrough), not
  // to gate visibility on metadata the publisher may omit or malform. A
  // payload with valid items but missing/wrong-typed weekOf/cadence still
  // parses as structured; only `version` and `items` are load-bearing.
  weekOf?: string;
  cadence?: CarouselBatchCadence;
  items: CarouselBatchItem[];
}

// Runtime shape guard — payload is `Record<string, unknown>` at the API
// boundary (interaction.payload), so a malformed or absent field must
// degrade to "not structured" rather than throw deep in the sweep loop.
//
// Only `version === 1` and `items` (an array of well-formed items — 0 items
// is a legitimate "batch held everything over" state, see the dedicated
// test) are required. `weekOf`/`cadence` are passthrough-if-well-formed,
// dropped-if-not — a contract wobble on metadata must never blind the
// operator to the batch itself (the whole reason this structured path
// exists).
export function parseCarouselBatchPayload(raw: unknown): CarouselBatchPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;

  const weekOf = typeof obj.weekOf === "string" ? obj.weekOf : undefined;

  let cadence: CarouselBatchCadence | undefined;
  const cadenceRaw = obj.cadence;
  if (cadenceRaw && typeof cadenceRaw === "object") {
    const cadenceObj = cadenceRaw as Record<string, unknown>;
    if (
      Array.isArray(cadenceObj.days) &&
      cadenceObj.days.every((d) => typeof d === "string") &&
      typeof cadenceObj.held === "number" &&
      typeof cadenceObj.strays === "number"
    ) {
      cadence = {
        days: cadenceObj.days as string[],
        held: cadenceObj.held,
        strays: cadenceObj.strays,
        ...(typeof cadenceObj.heldOldestWeek === "string" ? { heldOldestWeek: cadenceObj.heldOldestWeek } : {}),
      };
    }
  }

  if (!Array.isArray(obj.items)) return null;
  const items: CarouselBatchItem[] = [];
  for (const rawItem of obj.items) {
    if (!rawItem || typeof rawItem !== "object") return null;
    const item = rawItem as Record<string, unknown>;
    if (typeof item.slug !== "string") return null;
    if (item.day !== null && typeof item.day !== "string") return null;
    if (typeof item.caption !== "string") return null;
    if (!Array.isArray(item.slides) || !item.slides.every((s) => typeof s === "string")) return null;
    items.push({ slug: item.slug, day: item.day, caption: item.caption, slides: item.slides as string[] });
  }
  return {
    version: 1,
    ...(weekOf !== undefined ? { weekOf } : {}),
    ...(cadence !== undefined ? { cadence } : {}),
    items,
  };
}

// Adapts a structured CarouselBatchPayload into the same ParsedCarouselBatch
// shape the legacy regex parser produces, so the sweep's rendering path
// (postCarouselSection/renderCarouselSlideEmbeds) is IDENTICAL regardless of
// which detection path fired. 1-based index assigned in item order (matches
// the legacy `**N. slug (Day)**` numbering convention).
export function carouselBatchFromStructuredPayload(payload: CarouselBatchPayload): ParsedCarouselBatch {
  const sections: CarouselSection[] = payload.items.map((item, i) => ({
    index: i + 1,
    slug: item.slug,
    day: item.day ?? "unplanned",
    slideUrls: item.slides,
    caption: item.caption,
    degraded: false,
  }));
  const totalImagesFound = sections.reduce((sum, s) => sum + s.slideUrls.length, 0);
  return { sections, totalImagesFound, wasCapFallback: false };
}

// Section heading: **N. slug (Day)** — the documented carousel-batch authoring
// form. Captures the 1-based index, slug, and day label. Exported so callers
// (e.g. the confirmation-sweep's shape detection) test against the same
// pattern instead of maintaining a duplicate.
export const SECTION_HEADING_RE = /^\*\*(\d+)\.\s+([\w-]+)\s+\(([^)]+)\)\*\*/m;
const IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;

export interface CarouselSection {
  index: number;
  slug: string;
  day: string;
  slideUrls: string[];
  caption: string;
  // true when this section's slideUrls look truncated relative to its own
  // caption/body text (the authoring skill's 20000-char cap-fallback form).
  degraded: boolean;
}

export interface ParsedCarouselBatch {
  sections: CarouselSection[];
  totalImagesFound: number;
  // true when the whole artifact appears to have hit the authoring skill's
  // 20000-char cap and fallen back to first-slide + R2 path + caption form.
  wasCapFallback: boolean;
}

// Split detailsMarkdown into per-section raw text blocks using the section
// heading as the boundary. Returns [] when no heading matches at all (caller
// treats this as "not a carousel-batch shape").
function splitIntoSectionBlocks(detailsMarkdown: string): string[] {
  const lines = detailsMarkdown.split("\n");
  const headingLineIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADING_RE.test(lines[i])) headingLineIdxs.push(i);
  }
  if (headingLineIdxs.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < headingLineIdxs.length; i++) {
    const start = headingLineIdxs[i];
    const end = i + 1 < headingLineIdxs.length ? headingLineIdxs[i + 1] : lines.length;
    blocks.push(lines.slice(start, end).join("\n"));
  }
  return blocks;
}

// A section is a cap-fallback candidate when it has ≤1 slideUrl AND its body
// text (the caption, minus image lines) references an R2/slide path — the
// authoring skill's documented fallback form when the full artifact would
// exceed the 20000-char cap: first-slide image + raw R2 path text + caption.
function looksLikeCapFallbackSection(slideUrls: string[], bodyText: string): boolean {
  if (slideUrls.length > 1) return false;
  // A raw (non-markdown-image) reference to an r2/http path in the body text
  // is the fallback tell — the full slide set collapsed into path text.
  return /https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/i.test(bodyText);
}

export function parseCarouselBatchMarkdown(detailsMarkdown: string): ParsedCarouselBatch {
  const blocks = splitIntoSectionBlocks(detailsMarkdown);
  if (blocks.length === 0) {
    return { sections: [], totalImagesFound: 0, wasCapFallback: false };
  }

  const sections: CarouselSection[] = [];
  let totalImagesFound = 0;
  let capCandidateCount = 0;

  for (const block of blocks) {
    const headingMatch = SECTION_HEADING_RE.exec(block);
    if (!headingMatch) continue;
    const index = Number(headingMatch[1]);
    const slug = headingMatch[2];
    const day = headingMatch[3];

    // Body = everything after the heading line.
    const afterHeading = block.slice(block.indexOf(headingMatch[0]) + headingMatch[0].length);

    const slideUrls: string[] = [];
    let m: RegExpExecArray | null;
    IMAGE_RE.lastIndex = 0;
    while ((m = IMAGE_RE.exec(afterHeading)) !== null) {
      slideUrls.push(m[1]);
    }

    // Caption = every non-image line in the section body, joined in document
    // order. Image lines are stripped wherever they fall — before, between, or
    // after — so caption text never bleeds image syntax and is never dropped
    // just because it precedes or is sandwiched between slide images.
    const caption = afterHeading
      .split("\n")
      .filter((line) => !/^\s*!\[/.test(line) && line.trim() !== "")
      .join("\n")
      .trim();

    totalImagesFound += slideUrls.length;

    const degraded = looksLikeCapFallbackSection(slideUrls, caption);
    if (degraded) capCandidateCount++;

    sections.push({ index, slug, day, slideUrls, caption, degraded });
  }

  // wasCapFallback: sections exist AND every section shows the degraded
  // (≤1 slideUrl + path-referencing caption) shape.
  const wasCapFallback = sections.length > 0 && capCandidateCount === sections.length;

  return { sections, totalImagesFound, wasCapFallback };
}

// UNSTRUCTURED DEGRADE (kills failure 2's blind spot): a carousel-titled
// issue whose interaction matches NEITHER the structured payload contract NOR
// the legacy `**N. slug (Day)**` heading shape — e.g. an LLM-authored `##
// akihabara (Sat)` heading instead of the documented bold-numbered form
// (2026-07-11 live incident). Rather than silently falling to the generic
// path (which calls stripImageLines and would render captions with ZERO
// slides and ZERO buttons), this renders the WHOLE raw artifact as one
// synthetic section: every image URL found anywhere in the text becomes a
// slide (nothing dropped), and the non-image text becomes the caption,
// prefixed with a loud warning so the contract miss is visible, never blind.
export function buildUnstructuredDegradeSection(detailsMarkdown: string): CarouselSection {
  const slideUrls: string[] = [];
  let m: RegExpExecArray | null;
  IMAGE_RE.lastIndex = 0;
  while ((m = IMAGE_RE.exec(detailsMarkdown)) !== null) {
    slideUrls.push(m[1]);
  }
  const caption = detailsMarkdown
    .split("\n")
    .filter((line) => !/^\s*!\[/.test(line) && line.trim() !== "")
    .join("\n")
    .trim();
  return {
    index: 1,
    slug: "unstructured",
    day: "unknown",
    slideUrls,
    caption: `⚠ unstructured artifact — showing raw content (structured/legacy detection both missed this batch's shape)\n\n${caption}`,
    degraded: true,
  };
}

/**
 * Render one embed per slide for a carousel section. Each embed gets its own
 * `image.url` (never a shared `embed.url` across slides — that triggers
 * Discord's undocumented gallery-merge behavior, which is unsupported and
 * would collapse what should be N distinct rendered slides). Embeds are run
 * through enforceEmbedLimits.
 */
export function renderCarouselSlideEmbeds(section: CarouselSection): APIEmbed[] {
  const total = section.slideUrls.length;
  const footerText = safe(`${section.slug} · ${section.day}`, 2048);
  return section.slideUrls.map((url, i) =>
    enforceEmbedLimits({
      title: safe(`Slide ${i + 1}/${total}`, 256),
      image: { url },
      footer: { text: footerText },
    }),
  );
}
