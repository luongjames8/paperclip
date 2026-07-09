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
    let lastImageEnd = 0;
    let m: RegExpExecArray | null;
    IMAGE_RE.lastIndex = 0;
    while ((m = IMAGE_RE.exec(afterHeading)) !== null) {
      slideUrls.push(m[1]);
      lastImageEnd = m.index + m[0].length;
    }

    // Caption = text after the LAST image line, trimmed. Strip any residual
    // image markdown lines defensively (handles captions that precede images
    // or interleave — never bleed image syntax into the caption text).
    const afterLastImage = afterHeading.slice(lastImageEnd);
    const caption = afterLastImage
      .split("\n")
      .filter((line) => !/^\s*!\[/.test(line))
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
