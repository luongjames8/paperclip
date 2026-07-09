import type { APIEmbed } from "discord.js";
import { enforceEmbedLimits, safe } from "./embeds.js";

// NOTE: renderSlidesDoc in ./issue-docs.ts renders the SAME artifact kind
// (carousel slides) for the request_board_approval flow from a JSON slides
// doc. If the carousel gate ever migrates entity types again, both surfaces
// must move together — that migration silently dropping the renderer is
// exactly the historical failure this file exists to fix (see PR #27 body).

// Section heading: **N. slug (Day)** — the documented carousel-batch authoring
// form. Captures the 1-based index, slug, and day label. Exported so callers
// (e.g. the confirmation-sweep's shape detection) test against the same
// pattern instead of maintaining a duplicate.
//
// Two deliberate properties (seam-hardening pass, PR #27):
// - The slug group is permissive (`.+?`, not `[\w-]+`): a dot, space, or
//   unicode char in an LLM-authored slug must not make its whole section
//   silently vanish from the parse. Backtracking resolves slug-vs-day when
//   the slug itself contains parentheses.
// - The pattern is FULL-LINE anchored (`\s*$`): a heading-shaped string
//   embedded mid-sentence in caption prose (e.g. "…see **2. x (Tue)** which…")
//   must not split the section at a phantom boundary. Only a line that IS a
//   heading starts a section.
export const SECTION_HEADING_RE = /^\*\*(\d+)\.\s+(.+?)\s+\(([^)]+)\)\*\*[.,;:]?\s*$/m;
// A line that LOOKS like it wants to be a heading (bold + index) but was
// rejected by the full grammar. Surfaced by name in the header warning so a
// dropped section is never an anonymous statistic.
const HEADING_LIKE_RE = /^\s*\*\*\d+\./;
// Image tag: lazy URL capture with a boundary lookahead so a ')' INSIDE the
// URL (e.g. …/slide-1(final).jpg) doesn't truncate the capture at the first
// paren. The lookahead tolerates common prose/markdown terminators after the
// closing paren (period, emphasis, comma…) so adjoining punctuation can't
// make the whole tag invisible. An optional CommonMark title attribute
// (`"…"`) is consumed but not captured. Captured URLs are additionally
// validated with `new URL()` at attribution time; an unparseable capture
// counts as unattributed (warned), never silently posted as a broken embed.
// GREEDY URL capture (not lazy): with punctuation allowed after the closing
// paren, a lazy capture would stop at the FIRST ')' inside a paren-bearing
// URL (…slide-1(final).jpg → truncated at "(final"). Greedy prefers the
// longest URL still ending at a valid ')'+terminator, satisfying both the
// paren-in-URL and punctuation-after-tag cases (each pinned by tests).
const IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/\S+)(?:\s+"[^"]*")?\)(?=[\s.,;:!?*_~)]|$)/g;
// A caption line is stripped ONLY when it is a complete image tag — the same
// shape IMAGE_RE matches — never on the loose "starts with ![" prefix (a
// literal prose line beginning with "![" must stay in the caption, not vanish).
const IMAGE_LINE_RE = /^\s*!\[[^\]]*\]\(https?:\/\/\S+(?:\s+"[^"]*")?\)[.,;:!?]*\s*$/;

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
  // Image-markdown matches in the RAW artifact that no parsed section
  // attributed (images before the first heading, or under a heading the
  // grammar rejected). Non-zero means the parse LOST slides — callers must
  // surface this explicitly (never silent truncation).
  unattributedImages: number;
  // Lines that look heading-shaped (bold + numeric index) but were rejected
  // by the full heading grammar — surfaced BY NAME so a dropped section is
  // never an anonymous statistic.
  rejectedHeadingLines: string[];
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
// text references SIBLING slide paths (same directory as the one rendered
// slide) as bare text — the authoring skill's documented fallback form when
// the full artifact would exceed the 20000-char cap: first-slide image + raw
// R2 path text + caption. An UNRELATED image URL mentioned in caption prose
// (different host/path) must NOT trip this — a false "hit the cap" warning
// misrepresents the batch to the operator making the decision.
function looksLikeCapFallbackSection(slideUrls: string[], bodyText: string): boolean {
  if (slideUrls.length > 1) return false;
  const bareImageUrls = bodyText.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)/gi) ?? [];
  if (bareImageUrls.length === 0) return false;
  if (slideUrls.length === 0) return true; // no rendered slide at all + bare paths = collapsed form
  const dirPrefix = slideUrls[0].slice(0, slideUrls[0].lastIndexOf("/") + 1);
  return bareImageUrls.some((u) => u.startsWith(dirPrefix) && !slideUrls.includes(u));
}

// Count every image-markdown match in a text, independent of section grammar.
// The reconciliation source of truth: parsed sections must account for all of
// these, or the difference is surfaced as unattributedImages.
function countRawImages(text: string): number {
  IMAGE_RE.lastIndex = 0;
  let count = 0;
  while (IMAGE_RE.exec(text) !== null) count++;
  return count;
}

// Heading-shaped lines the full grammar rejected — reported by name.
function findRejectedHeadingLines(detailsMarkdown: string): string[] {
  return detailsMarkdown
    .split("\n")
    .filter((line) => HEADING_LIKE_RE.test(line) && !SECTION_HEADING_RE.test(line))
    .map((line) => line.trim().slice(0, 120));
}

export function parseCarouselBatchMarkdown(detailsMarkdown: string): ParsedCarouselBatch {
  const rawImageCount = countRawImages(detailsMarkdown);
  const rejectedHeadingLines = findRejectedHeadingLines(detailsMarkdown);
  const blocks = splitIntoSectionBlocks(detailsMarkdown);
  if (blocks.length === 0) {
    return { sections: [], totalImagesFound: 0, wasCapFallback: false, unattributedImages: rawImageCount, rejectedHeadingLines };
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
      // Fail closed on a malformed capture: an unparseable URL is skipped
      // here, so it stays in the raw count and surfaces as unattributed —
      // never a silently broken embed.
      try {
        new URL(m[1]);
        slideUrls.push(m[1]);
      } catch {
        /* counted by countRawImages; flows into unattributedImages */
      }
    }

    // Caption = every non-image line in the section body, joined in document
    // order. Only COMPLETE image-tag lines are stripped (IMAGE_LINE_RE) —
    // prose that merely starts with "![" stays in the caption.
    const caption = afterHeading
      .split("\n")
      .filter((line) => !IMAGE_LINE_RE.test(line) && line.trim() !== "")
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

  // Reconcile: any raw image the section parse did not attribute is a LOST
  // slide (image above the first heading, or in a block whose heading the
  // grammar rejected). Never let that be silent — callers render a warning.
  const unattributedImages = Math.max(0, rawImageCount - totalImagesFound);

  return { sections, totalImagesFound, wasCapFallback, unattributedImages, rejectedHeadingLines };
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
