import { describe, it, expect } from "vitest";
import {
  parseCarouselBatchMarkdown,
  renderCarouselSlideEmbeds,
  parseCarouselBatchPayload,
  carouselBatchFromStructuredPayload,
  buildUnstructuredDegradeSection,
  type CarouselBatchPayload,
} from "../src/render/carousel-batch.js";

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

// ─── STRUCTURED PAYLOAD CONTRACT (version 1) ─────────────────────────────────

function validPayload(overrides: Partial<CarouselBatchPayload> = {}): CarouselBatchPayload {
  return {
    version: 1,
    weekOf: "2026-07-13",
    cadence: { days: ["Sat", "Sun"], held: 0, strays: 0 },
    items: [
      { slug: "akihabara", day: "Sat", caption: "Electric town.", slides: ["https://r2.example.com/a1.jpg", "https://r2.example.com/a2.jpg"] },
      { slug: "shibuya", day: "Sun", caption: "Crossing.", slides: ["https://r2.example.com/s1.jpg"] },
    ],
    ...overrides,
  };
}

describe("parseCarouselBatchPayload", () => {
  it("parses a well-formed version-1 payload", () => {
    const parsed = parseCarouselBatchPayload(validPayload());
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.items).toHaveLength(2);
  });

  it("accepts an optional heldOldestWeek on cadence", () => {
    const parsed = parseCarouselBatchPayload(validPayload({ cadence: { days: [], held: 3, strays: 0, heldOldestWeek: "2026-07-06" } }));
    expect(parsed!.cadence.heldOldestWeek).toBe("2026-07-06");
  });

  it("accepts a null day on an item (unplanned stray)", () => {
    const parsed = parseCarouselBatchPayload(validPayload({ items: [{ slug: "extra", day: null, caption: "Stray post.", slides: [] }] }));
    expect(parsed!.items[0].day).toBeNull();
  });

  it("accepts an item with ZERO slides", () => {
    const parsed = parseCarouselBatchPayload(validPayload({ items: [{ slug: "a", day: "Sat", caption: "c", slides: [] }] }));
    expect(parsed!.items[0].slides).toEqual([]);
  });

  // ── Malformed-shape guards — every one degrades to null, never throws ──────
  it("null/undefined → null", () => {
    expect(parseCarouselBatchPayload(null)).toBeNull();
    expect(parseCarouselBatchPayload(undefined)).toBeNull();
  });

  it("non-object (string, number) → null", () => {
    expect(parseCarouselBatchPayload("not an object")).toBeNull();
    expect(parseCarouselBatchPayload(42)).toBeNull();
  });

  it("wrong version → null", () => {
    expect(parseCarouselBatchPayload({ ...validPayload(), version: 2 })).toBeNull();
    expect(parseCarouselBatchPayload({ ...validPayload(), version: "1" })).toBeNull();
  });

  it("missing weekOf → null", () => {
    const { weekOf, ...rest } = validPayload();
    expect(parseCarouselBatchPayload(rest)).toBeNull();
  });

  it("missing/malformed cadence → null", () => {
    expect(parseCarouselBatchPayload({ ...validPayload(), cadence: undefined })).toBeNull();
    expect(parseCarouselBatchPayload({ ...validPayload(), cadence: { days: "not-an-array", held: 0, strays: 0 } })).toBeNull();
    expect(parseCarouselBatchPayload({ ...validPayload(), cadence: { days: [], held: "zero", strays: 0 } })).toBeNull();
  });

  it("items not an array → null", () => {
    expect(parseCarouselBatchPayload({ ...validPayload(), items: "not-an-array" })).toBeNull();
  });

  it("an item missing a required field → null (whole payload rejected, not a partial parse)", () => {
    expect(parseCarouselBatchPayload({ ...validPayload(), items: [{ slug: "a", day: "Sat", slides: [] }] })).toBeNull(); // missing caption
    expect(parseCarouselBatchPayload({ ...validPayload(), items: [{ slug: "a", day: "Sat", caption: "c", slides: "not-array" }] })).toBeNull();
  });

  it("0 items (empty array) is VALID — a batch that held everything over", () => {
    const parsed = parseCarouselBatchPayload(validPayload({ items: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed!.items).toEqual([]);
  });
});

describe("carouselBatchFromStructuredPayload", () => {
  it("maps items to sections 1-based in order, never touching regex/markdown", () => {
    const result = carouselBatchFromStructuredPayload(validPayload());
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toEqual({ index: 1, slug: "akihabara", day: "Sat", slideUrls: ["https://r2.example.com/a1.jpg", "https://r2.example.com/a2.jpg"], caption: "Electric town.", degraded: false });
    expect(result.sections[1].index).toBe(2);
    expect(result.totalImagesFound).toBe(3);
    expect(result.wasCapFallback).toBe(false);
  });

  it("null day (unplanned stray) renders as day 'unplanned'", () => {
    const result = carouselBatchFromStructuredPayload(validPayload({ items: [{ slug: "extra", day: null, caption: "c", slides: [] }] }));
    expect(result.sections[0].day).toBe("unplanned");
  });

  it("0 items → 0 sections, 0 images — caller decides what to do (postCarouselBatch skips posting)", () => {
    const result = carouselBatchFromStructuredPayload(validPayload({ items: [] }));
    expect(result.sections).toEqual([]);
    expect(result.totalImagesFound).toBe(0);
  });
});

// ─── UNSTRUCTURED DEGRADE (contract miss must be visible, never blind) ───────

describe("buildUnstructuredDegradeSection", () => {
  it("extracts every image URL regardless of heading shape (the live-incident `## slug (Day)` case)", () => {
    const markdown = "## akihabara (Sat)\n![a](https://r2.example.com/1.jpg)\n![b](https://r2.example.com/2.jpg)\n\nElectric town.";
    const section = buildUnstructuredDegradeSection(markdown);
    expect(section.slideUrls).toEqual(["https://r2.example.com/1.jpg", "https://r2.example.com/2.jpg"]);
  });

  it("caption is prefixed with a loud '⚠ unstructured artifact' warning", () => {
    const section = buildUnstructuredDegradeSection("Some text.\n![x](https://r2.example.com/1.jpg)");
    expect(section.caption).toMatch(/^⚠ unstructured artifact/);
  });

  it("non-image text is preserved in the caption (nothing dropped, only image lines filtered)", () => {
    const markdown = [
      "## akihabara (Sat)",
      "![a](https://r2.example.com/1.jpg)",
      "",
      "Electric town vibes.",
      "",
      "Key: slug=akihabara weekOf=2026-07-13 plannedDay=Sat",
      "Cadence: Sat+Sun (2 slots) | Strays: 0 | Held: 0",
    ].join("\n");
    const section = buildUnstructuredDegradeSection(markdown);
    expect(section.caption).toContain("Electric town vibes.");
    expect(section.caption).toContain("Key: slug=akihabara weekOf=2026-07-13 plannedDay=Sat");
    expect(section.caption).toContain("Cadence: Sat+Sun (2 slots) | Strays: 0 | Held: 0");
  });

  it("degraded flag is always true (visually distinguishable from a clean structured/legacy parse)", () => {
    const section = buildUnstructuredDegradeSection("no images here at all");
    expect(section.degraded).toBe(true);
    expect(section.slideUrls).toEqual([]);
  });

  it("zero images in the artifact still produces a section (caption-only render, never silently dropped)", () => {
    const section = buildUnstructuredDegradeSection("Just prose, no image markdown.");
    expect(section.slideUrls).toEqual([]);
    expect(section.caption).toContain("Just prose, no image markdown.");
  });
});
