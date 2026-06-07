import { describe, expect, it } from "vitest";
import {
  countNarratorWords,
  discardRate,
  quoteInjection,
  hookLength,
  conclusionBehavior,
  finalLength,
  punchupIntegrity,
} from "../src/engine/gates.js";

// Behaviors ported from canonical pipeline-mcp gates.js. The 5 gates that read
// DRAFT_CONTENT.md / RESEARCH_MASTER.yaml from disk in the canonical engine are
// refactored here to be PURE over the artifact content/object the conductor
// reads from issue documents — no filesystem.

const SECTIONS = [
  "## SECTION 1: Hook",
  "A short punchy hook line.",
  "",
  "## SECTION 2: Body",
  "[dp_1] Evidence one. [q_1] A quote.",
  "",
  "## SECTION 3: Close",
  "A measured final beat that simply ends.",
].join("\n");

describe("countNarratorWords", () => {
  it("counts narration, skipping headers/tags/yaml/rules/fence markers", () => {
    // Faithful to canonical: ``` MARKER lines are skipped (fence content itself is not specially excluded).
    const text = ["## SECTION 1: Hook", "[B-ROLL: city]", "key: value", "---", "Three real words here", "```", "```"].join("\n");
    expect(countNarratorWords(text)).toBe(4); // only "Three real words here"
  });
});

describe("structure:discard_rate", () => {
  const params = { standard_min: 0.4, comprehensive_min: 0.2 };
  it("passes (promotions path) when minimum met", () => {
    const r = discardRate(
      { selection_mode: "standard", original_spine_count: 10, promotions_made: 2, effective_spine_count: 12, units_selected: 8, minimum_required: 8, minimum_met: true },
      params,
    );
    expect(r.pass).toBe(true);
  });
  it("passes (no-promotion path) when discard rate meets the minimum", () => {
    const r = discardRate(
      { selection_mode: "standard", original_spine_count: 10, promotions_made: 0, effective_spine_count: 10, units_selected: 5, minimum_required: 5, minimum_met: true },
      params,
    );
    expect(r.pass).toBe(true);
  });
  it("blocks when discard rate is below the minimum", () => {
    const r = discardRate(
      { selection_mode: "standard", original_spine_count: 10, promotions_made: 0, effective_spine_count: 10, units_selected: 9, minimum_required: 5 },
      params,
    );
    expect(r.pass).toBe(false);
  });
  it("supports the legacy input shape", () => {
    expect(discardRate({ selection_mode: "standard", spine_material_available: 10, units_selected: 5 }, params).pass).toBe(true);
  });
});

describe("writing:quote_injection", () => {
  it("passes with >= 10 sources (current format)", () => {
    const research = { sources: Array.from({ length: 11 }, (_, i) => ({ credibility: i < 3 ? "high" : "medium" })) };
    expect(quoteInjection({ research }).pass).toBe(true);
  });
  it("blocks with too few sources", () => {
    expect(quoteInjection({ research: { sources: [{}, {}] } }).pass).toBe(false);
  });
  it("supports the legacy data_points + quotes format", () => {
    const research = { data_points: Array.from({ length: 6 }, () => ({ confidence: "high" })), quotes: Array.from({ length: 5 }, () => ({})) };
    expect(quoteInjection({ research }).pass).toBe(true);
  });
});

describe("writing:hook_length", () => {
  const params = { max_words: 80 };
  it("passes when Section 1 is under the max", () => {
    expect(hookLength({ content: SECTIONS }, params).pass).toBe(true);
  });
  it("blocks when Section 1 exceeds the max", () => {
    const long = ["## SECTION 1: Hook", Array.from({ length: 90 }, (_, i) => `w${i}`).join(" "), "## SECTION 2: Body", "x"].join("\n");
    expect(hookLength({ content: long }, params).pass).toBe(false);
  });
  it("blocks when Section 1 is absent", () => {
    expect(hookLength({ content: "## SECTION 2: Body\nno hook" }, params).pass).toBe(false);
  });
});

describe("writing:conclusion_behavior", () => {
  const params = { banned_phrases: ["in conclusion", "to summarize"] };
  it("passes when the final section has no banned phrases", () => {
    expect(conclusionBehavior({ content: SECTIONS }, params).pass).toBe(true);
  });
  it("blocks when the final section contains a banned phrase", () => {
    const bad = SECTIONS.replace("A measured final beat that simply ends.", "In conclusion, that is the point.");
    expect(conclusionBehavior({ content: bad }, params).pass).toBe(false);
  });
});

describe("writing:final_length", () => {
  const params = { warn_threshold: 60, block_threshold: 80 };
  it("passes (CONTINUE) when the final section is short", () => {
    const r = finalLength({ content: SECTIONS }, params);
    expect(r.pass).toBe(true);
    expect(r.action).toBe("CONTINUE");
  });
  it("warns (pass) when between warn and block thresholds", () => {
    const body = Array.from({ length: 70 }, (_, i) => `w${i}`).join(" ");
    const content = ["## SECTION 1: Hook", "hi", "## SECTION 2: Close", body].join("\n");
    const r = finalLength({ content }, params);
    expect(r.pass).toBe(true);
    expect(r.action).toBe("WARN");
  });
  it("blocks when the final section exceeds the block threshold", () => {
    const body = Array.from({ length: 90 }, (_, i) => `w${i}`).join(" ");
    const content = ["## SECTION 1: Hook", "hi", "## SECTION 2: Close", body].join("\n");
    expect(finalLength({ content }, params).pass).toBe(false);
  });
});

describe("writing:punchup_integrity", () => {
  const params = { max_word_delta: 0.15 };
  it("passes when sections + citations preserved and word delta small", () => {
    expect(punchupIntegrity({ original: SECTIONS, punched: SECTIONS }, params).pass).toBe(true);
  });
  it("blocks when a citation is dropped", () => {
    const punched = SECTIONS.replace("[dp_1] ", "");
    expect(punchupIntegrity({ original: SECTIONS, punched }, params).pass).toBe(false);
  });
  it("blocks when the section count changes", () => {
    const punched = SECTIONS + "\n## SECTION 4: Extra\nmore";
    expect(punchupIntegrity({ original: SECTIONS, punched }, params).pass).toBe(false);
  });
});
