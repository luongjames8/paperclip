import { describe, expect, it } from "vitest";
import { assemblePrompt } from "../src/engine/prompt.js";

describe("assemblePrompt", () => {
  it("prepends each input as a named section before the prompt", () => {
    const result = assemblePrompt("THE PROMPT", { "file1.yaml": "content1", "file2.yaml": "content2" });
    expect(result).toContain("## Input: file1.yaml\n\ncontent1\n\n---\n\n");
    expect(result).toContain("## Input: file2.yaml\n\ncontent2\n\n---\n\n");
    expect(result).toContain("THE PROMPT");
    // Inputs come before the prompt
    expect(result.indexOf("## Input: file1.yaml")).toBeLessThan(result.indexOf("THE PROMPT"));
  });

  it("substitutes {pre_fetched_data} in the prompt when preFetchedSection is provided", () => {
    const promptContent = "Before {pre_fetched_data} After";
    const result = assemblePrompt(promptContent, {}, "PREFETCHED_CONTENT");
    expect(result).toContain("Before PREFETCHED_CONTENT After");
    expect(result).not.toContain("{pre_fetched_data}");
  });

  it("prepends preFetchedSection when prompt does NOT contain {pre_fetched_data}", () => {
    const result = assemblePrompt("NO PLACEHOLDER", {}, "PREFETCHED");
    expect(result).toContain("PREFETCHED");
    expect(result).toContain("NO PLACEHOLDER");
    expect(result.indexOf("PREFETCHED")).toBeLessThan(result.indexOf("NO PLACEHOLDER"));
  });

  it("outputs just inputs + prompt when no preFetchedSection", () => {
    const result = assemblePrompt("PROMPT TEXT", { "a.yaml": "AAA" });
    expect(result).toBe("## Input: a.yaml\n\nAAA\n\n---\n\nPROMPT TEXT");
  });

  it("outputs just the prompt when inputs are empty and no preFetchedSection", () => {
    const result = assemblePrompt("ONLY PROMPT", {});
    expect(result).toBe("ONLY PROMPT");
  });

  it("handles multiple inputs with placeholder substitution", () => {
    const promptContent = "Fetched: {pre_fetched_data}";
    const result = assemblePrompt(promptContent, { "i1.yaml": "val1", "i2.yaml": "val2" }, "PREFETCHED");
    expect(result).toContain("## Input: i1.yaml\n\nval1\n\n---\n\n");
    expect(result).toContain("## Input: i2.yaml\n\nval2\n\n---\n\n");
    expect(result).toContain("Fetched: PREFETCHED");
  });
});
