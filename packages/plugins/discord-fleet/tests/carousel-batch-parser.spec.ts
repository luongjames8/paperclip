import { describe, it, expect } from "vitest";
import { parseCarouselBatchMarkdown, renderCarouselSlideEmbeds } from "../src/render/carousel-batch.js";

const SLUGS = [
  "tokyo-by-car-guide",
  "shibuya-crossing-tips",
  "osaka-food-tour",
  "kyoto-temple-walk",
  "hokkaido-winter-guide",
  "okinawa-beach-days",
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildSection(index: number, slug: string, day: string, imageCount: number, caption: string): string {
  const images = Array.from({ length: imageCount }, (_, i) => `![slide${i + 1}](https://r2.example.com/${slug}/slide-${i + 1}.jpg)`).join("\n");
  return `**${index}. ${slug} (${day})**\n${images}\n\n${caption}\n`;
}

function buildBatch(sectionsCount: number, imagesPerSection: number): string {
  const parts: string[] = [];
  for (let i = 0; i < sectionsCount; i++) {
    parts.push(buildSection(i + 1, SLUGS[i % SLUGS.length], DAYS[i % DAYS.length], imagesPerSection, `Caption text for section ${i + 1}. Review before publishing.`));
  }
  return parts.join("\n");
}

describe("parseCarouselBatchMarkdown", () => {
  it("parses 6 sections x 9 URLs each — order preserved, captions don't bleed, totalImagesFound 54", () => {
    const markdown = buildBatch(6, 9);
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(6);
    expect(parsed.totalImagesFound).toBe(54);
    expect(parsed.wasCapFallback).toBe(false);

    parsed.sections.forEach((section, i) => {
      expect(section.index).toBe(i + 1);
      expect(section.slug).toBe(SLUGS[i % SLUGS.length]);
      expect(section.day).toBe(DAYS[i % DAYS.length]);
      expect(section.slideUrls).toHaveLength(9);
      // Order preserved: slide-1 through slide-9 in sequence.
      section.slideUrls.forEach((url, j) => {
        expect(url).toBe(`https://r2.example.com/${section.slug}/slide-${j + 1}.jpg`);
      });
      // Caption doesn't bleed across sections.
      expect(section.caption).toBe(`Caption text for section ${i + 1}. Review before publishing.`);
      expect(section.caption).not.toContain("section " + (i + 2));
      expect(section.degraded).toBe(false);
    });
  });

  it("returns empty sections for markdown with no section heading (not a carousel-batch shape)", () => {
    const parsed = parseCarouselBatchMarkdown("Just a plain confirmation prompt with no headings.");
    expect(parsed.sections).toHaveLength(0);
    expect(parsed.totalImagesFound).toBe(0);
    expect(parsed.wasCapFallback).toBe(false);
  });

  it("degraded-form fixture (1 URL + raw path text per section) sets wasCapFallback true", () => {
    const parts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const slug = SLUGS[i];
      const day = DAYS[i];
      parts.push(
        `**${i + 1}. ${slug} (${day})**\n` +
          `![first](https://r2.example.com/${slug}/slide-1.jpg)\n\n` +
          `Full set: https://r2.example.com/${slug}/slide-2.jpg, https://r2.example.com/${slug}/slide-3.jpg (see paperclip for all)\n`,
      );
    }
    const markdown = parts.join("\n");
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(4);
    expect(parsed.wasCapFallback).toBe(true);
    parsed.sections.forEach((s) => {
      expect(s.slideUrls).toHaveLength(1);
      expect(s.degraded).toBe(true);
    });
  });

  it("wasCapFallback is false when only SOME sections are degraded (mixed shape)", () => {
    const full = buildSection(1, SLUGS[0], DAYS[0], 9, "Full caption, no path references here.");
    const degraded = `**2. ${SLUGS[1]} (${DAYS[1]})**\n![first](https://r2.example.com/${SLUGS[1]}/slide-1.jpg)\n\nFull set: https://r2.example.com/${SLUGS[1]}/slide-2.jpg\n`;
    const markdown = full + "\n" + degraded;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.wasCapFallback).toBe(false);
    expect(parsed.sections[0].degraded).toBe(false);
    expect(parsed.sections[1].degraded).toBe(true);
  });

  it("handles a single-section batch (1 section)", () => {
    const markdown = buildBatch(1, 5);
    const parsed = parseCarouselBatchMarkdown(markdown);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].slideUrls).toHaveLength(5);
    expect(parsed.totalImagesFound).toBe(5);
  });

  // Codex P2 (PR #27): caption text placed before or between image lines used
  // to be silently dropped (old parser only kept text AFTER the last image).

  it("caption BEFORE the images is preserved (not dropped)", () => {
    const markdown =
      `**1. ${SLUGS[0]} (${DAYS[0]})**\n` +
      `Caption text written before the slides.\n` +
      `![slide1](https://r2.example.com/${SLUGS[0]}/slide-1.jpg)\n` +
      `![slide2](https://r2.example.com/${SLUGS[0]}/slide-2.jpg)\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].caption).toBe("Caption text written before the slides.");
    expect(parsed.sections[0].slideUrls).toEqual([
      `https://r2.example.com/${SLUGS[0]}/slide-1.jpg`,
      `https://r2.example.com/${SLUGS[0]}/slide-2.jpg`,
    ]);
  });

  it("caption BETWEEN image lines is preserved, slide order stays document order", () => {
    const markdown =
      `**1. ${SLUGS[0]} (${DAYS[0]})**\n` +
      `![slide1](https://r2.example.com/${SLUGS[0]}/slide-1.jpg)\n` +
      `Mid-section note between slides 1 and 2.\n` +
      `![slide2](https://r2.example.com/${SLUGS[0]}/slide-2.jpg)\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].caption).toBe("Mid-section note between slides 1 and 2.");
    expect(parsed.sections[0].slideUrls).toEqual([
      `https://r2.example.com/${SLUGS[0]}/slide-1.jpg`,
      `https://r2.example.com/${SLUGS[0]}/slide-2.jpg`,
    ]);
  });

  it("caption split BEFORE and AFTER images — both parts preserved in document order", () => {
    const markdown =
      `**1. ${SLUGS[0]} (${DAYS[0]})**\n` +
      `Intro line before slides.\n` +
      `![slide1](https://r2.example.com/${SLUGS[0]}/slide-1.jpg)\n` +
      `![slide2](https://r2.example.com/${SLUGS[0]}/slide-2.jpg)\n` +
      `Closing line after slides.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].caption).toBe("Intro line before slides.\nClosing line after slides.");
    expect(parsed.sections[0].slideUrls).toEqual([
      `https://r2.example.com/${SLUGS[0]}/slide-1.jpg`,
      `https://r2.example.com/${SLUGS[0]}/slide-2.jpg`,
    ]);
  });
});

// Seam-hardening pass (PR #27): the slug group is permissive (`.+?`) so a
// dot, space, or unicode char in an LLM-authored slug doesn't silently drop
// the whole section from the parse.
describe("parseCarouselBatchMarkdown — widened slug grammar", () => {
  it("parses a slug containing a dot ('day-1.5-tour')", () => {
    const markdown =
      `**1. day-1.5-tour (Mon)**\n` +
      `![slide1](https://r2.example.com/day-1.5-tour/slide-1.jpg)\n\n` +
      `Caption for the half-day tour.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].slug).toBe("day-1.5-tour");
    expect(parsed.sections[0].day).toBe("Mon");
    expect(parsed.sections[0].slideUrls).toEqual(["https://r2.example.com/day-1.5-tour/slide-1.jpg"]);
  });

  it("parses a slug containing a space ('tokyo tour')", () => {
    const markdown =
      `**2. tokyo tour (Wed)**\n` +
      `![slide1](https://r2.example.com/tokyo-tour/slide-1.jpg)\n\n` +
      `Caption for the tokyo tour.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].slug).toBe("tokyo tour");
    expect(parsed.sections[0].day).toBe("Wed");
    expect(parsed.sections[0].slideUrls).toEqual(["https://r2.example.com/tokyo-tour/slide-1.jpg"]);
  });

  it("parses a unicode slug ('京都-散歩')", () => {
    const markdown =
      `**3. 京都-散歩 (Fri)**\n` +
      `![slide1](https://r2.example.com/kyoto-walk/slide-1.jpg)\n\n` +
      `Caption for the kyoto walk.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].slug).toBe("京都-散歩");
    expect(parsed.sections[0].day).toBe("Fri");
    expect(parsed.sections[0].slideUrls).toEqual(["https://r2.example.com/kyoto-walk/slide-1.jpg"]);
  });
});

// Seam-hardening pass (PR #27): the heading pattern is full-line anchored —
// a heading-shaped string embedded mid-sentence in caption prose must not
// split the section at a phantom boundary.
describe("parseCarouselBatchMarkdown — full-line anchoring (no mid-sentence split)", () => {
  it("a caption referencing a heading-shaped string mid-sentence does not start a new section", () => {
    const markdown =
      `**1. tokyo-by-car-guide (Mon)**\n` +
      `![slide1](https://r2.example.com/tokyo-by-car-guide/slide-1.jpg)\n\n` +
      `See below…see **2. shibuya-night (Tue)** which covers nightlife too.\n` +
      `**2. shibuya-crossing-tips (Tue)**\n` +
      `![slide1](https://r2.example.com/shibuya-crossing-tips/slide-1.jpg)\n\n` +
      `Real second section caption.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    // Only 2 TRUE sections — the mid-sentence "**2. shibuya-night (Tue)**"
    // string does not create a phantom 3rd section, and does not truncate
    // section 1's caption.
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].slug).toBe("tokyo-by-car-guide");
    expect(parsed.sections[0].caption).toContain("See below…see **2. shibuya-night (Tue)** which covers nightlife too.");
    expect(parsed.sections[1].slug).toBe("shibuya-crossing-tips");
    expect(parsed.sections[1].caption).toBe("Real second section caption.");
  });
});

// Seam-hardening pass (PR #27): reconciliation — an image above the first
// heading is never silently dropped; it surfaces as unattributedImages, and
// the sweep's header warns about it.
describe("parseCarouselBatchMarkdown — unattributedImages reconciliation", () => {
  it("an image line ABOVE the first heading is not attributed to any section", () => {
    const markdown =
      `![orphan](https://r2.example.com/orphan/slide-1.jpg)\n` +
      `**1. tokyo-by-car-guide (Mon)**\n` +
      `![slide1](https://r2.example.com/tokyo-by-car-guide/slide-1.jpg)\n\n` +
      `Caption for section 1.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.unattributedImages).toBe(1);
    // totalImagesFound counts only attributed (in-section) images.
    expect(parsed.totalImagesFound).toBe(1);
  });
});

// Pin: a URL containing a literal '(' before the closing ')' (e.g. an R2 key
// with "(final)" in it) must be captured IN FULL — the lazy capture + boundary
// lookahead must not truncate at the first ')' inside the URL.
describe("parseCarouselBatchMarkdown — URL containing a literal paren", () => {
  it("captures the full URL including '(final).jpg', unattributedImages 0", () => {
    const markdown =
      `**1. ${SLUGS[0]} (${DAYS[0]})**\n` +
      `![s](https://r2.dev/a/slide-1(final).jpg)\n\n` +
      `Caption text.\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].slideUrls).toEqual(["https://r2.dev/a/slide-1(final).jpg"]);
    expect(parsed.unattributedImages).toBe(0);
  });
});

// Pin: an image tag whose captured URL matches IMAGE_RE (no whitespace inside)
// but throws on `new URL()` must be excluded from slideUrls and surfaced as
// unattributedImages, never posted as a broken embed. `https://:bad` has no
// host and is rejected by the URL constructor while still matching \S+.
describe("parseCarouselBatchMarkdown — URL that matches the regex but fails new URL()", () => {
  it("is excluded from slideUrls, unattributedImages 1", () => {
    const markdown =
      `**1. ${SLUGS[0]} (${DAYS[0]})**\n` +
      `![x](https://:bad)\n\n` +
      `Caption text.\n`;
    // Sanity: the raw capture matches IMAGE_RE but new URL() rejects it —
    // otherwise this pin would be testing the wrong failure mode.
    expect(() => new URL("https://:bad")).toThrow();

    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].slideUrls).toEqual([]);
    expect(parsed.unattributedImages).toBe(1);
  });
});

// Pin: a caption line that merely STARTS WITH an image-tag prefix but has no
// URL part (so it never matches IMAGE_LINE_RE) is prose, not an image tag —
// it must stay in the caption, not be stripped, and must not be counted as
// an unattributed image (it never matched IMAGE_RE either).
describe("parseCarouselBatchMarkdown — prose line starting with '![' but no URL", () => {
  it("stays in the caption, unattributedImages 0", () => {
    const markdown =
      `**1. ${SLUGS[0]} (${DAYS[0]})**\n` +
      `![slide1](https://r2.example.com/${SLUGS[0]}/slide-1.jpg)\n` +
      `![Note: this is not an image]\n`;
    const parsed = parseCarouselBatchMarkdown(markdown);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].caption).toBe("![Note: this is not an image]");
    expect(parsed.sections[0].slideUrls).toEqual([`https://r2.example.com/${SLUGS[0]}/slide-1.jpg`]);
    expect(parsed.unattributedImages).toBe(0);
  });
});

describe("renderCarouselSlideEmbeds", () => {
  it("renders one embed per slide with distinct image.url (never a shared embed.url across slides)", () => {
    const parsed = parseCarouselBatchMarkdown(buildBatch(1, 3));
    const embeds = renderCarouselSlideEmbeds(parsed.sections[0]);

    expect(embeds).toHaveLength(3);
    embeds.forEach((embed, i) => {
      expect(embed.image?.url).toBe(parsed.sections[0].slideUrls[i]);
      expect(embed.title).toBe(`Slide ${i + 1}/3`);
      // NEVER set embed.url — that would trigger Discord's undocumented
      // gallery-merge behavior across multiple embeds sharing one url.
      expect(embed.url).toBeUndefined();
      expect(embed.footer?.text).toContain(parsed.sections[0].slug);
      expect(embed.footer?.text).toContain(parsed.sections[0].day);
    });
  });
});
