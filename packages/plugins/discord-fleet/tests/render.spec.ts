import { describe, it, expect } from "vitest";
import { truncate } from "../src/render/plain.js";
import { enforceEmbedLimits } from "../src/render/embeds.js";

describe("render helpers", () => {
  it("truncate: message ≤1900 chars passes through unchanged", () => {
    const text = "a".repeat(1900);
    expect(truncate(text)).toBe(text);
  });

  it("truncate: message >1900 chars is truncated and ends with the URL", () => {
    const text = "a".repeat(2000);
    const url = "https://example.com/issues/123";
    const result = truncate(text, 1900, url);
    expect(result.length).toBeLessThanOrEqual(1900);
    expect(result.endsWith(url)).toBe(true);
  });

  it("enforceEmbedLimits: embed ≤6000 chars is unchanged", () => {
    const embed = {
      title: "b".repeat(100),
      description: "a".repeat(200),
    };
    const result = enforceEmbedLimits(embed);
    expect(result.title).toBe(embed.title);
    expect(result.description).toBe(embed.description);
  });

  it("enforceEmbedLimits: embed >6000 chars truncates description with ellipsis", () => {
    const embed = {
      title: "b".repeat(200),
      description: "a".repeat(5900),
    };
    // total = 6100 > 6000
    const result = enforceEmbedLimits(embed);
    const totalLen = (result.title?.length ?? 0) + (result.description?.length ?? 0);
    expect(totalLen).toBeLessThanOrEqual(6000);
    expect(result.description?.endsWith("…")).toBe(true);
  });

  it("enforceEmbedLimits: footer + author counted in 6000-char budget", () => {
    const embed = {
      title: "t".repeat(100),
      description: "a".repeat(5800),
      footer: { text: "f".repeat(100) },
      author: { name: "n".repeat(50) },
    };
    // title(100) + description(5800) + footer(100) + author(50) = 6050 > 6000
    const result = enforceEmbedLimits(embed);
    const totalLen =
      (result.title?.length ?? 0) +
      (result.description?.length ?? 0) +
      (result.footer?.text?.length ?? 0) +
      (result.author?.name?.length ?? 0);
    expect(totalLen).toBeLessThanOrEqual(6000);
    expect(result.description?.endsWith("…")).toBe(true);
  });
});
