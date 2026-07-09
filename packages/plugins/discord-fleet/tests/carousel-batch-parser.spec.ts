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
