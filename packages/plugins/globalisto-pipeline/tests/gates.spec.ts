import { describe, expect, it } from "vitest";
import {
  titleLength,
  fetchCount,
  adversarialCoverage,
  loopTeaseAlignment,
} from "../src/engine/gates.js";

// Behaviors ported from the canonical pipeline-mcp gates.js (runLocalGate).
// These gates are pure over their input — no filesystem, no ctx.

describe("angle:title_length", () => {
  const params = { min_words: 5, max_words: 12 };
  it("passes a title within the word range", () => {
    expect(titleLength({ title: "one two three four five six seven" }, params).pass).toBe(true);
  });
  it("blocks a title below the minimum", () => {
    const r = titleLength({ title: "too few words" }, params);
    expect(r.pass).toBe(false);
    expect(r.action).toBe("BLOCK");
  });
  it("blocks a title above the maximum", () => {
    const long = Array.from({ length: 14 }, (_, i) => `w${i}`).join(" ");
    expect(titleLength({ title: long }, params).pass).toBe(false);
  });
  it("blocks when no title provided", () => {
    expect(titleLength({ title: "" }, params).pass).toBe(false);
  });
});

describe("research:fetch_count", () => {
  const params = { min_fetches_per_slot: 3 };
  it("passes when every slot meets the minimum", () => {
    expect(fetchCount({ slots_fetched: { a: 3, b: 5 } }, params).pass).toBe(true);
  });
  it("blocks when any slot is under the minimum", () => {
    const r = fetchCount({ slots_fetched: { a: 3, b: 2 } }, params);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toContain("b");
  });
  it("blocks on missing slots_fetched", () => {
    expect(fetchCount({}, params).pass).toBe(false);
  });
});

describe("research:adversarial_coverage", () => {
  const params = { min_counter_items: 2 };
  it("passes with enough counter-evidence", () => {
    expect(adversarialCoverage({ counter_items: [{ id: "CE_1" }, { id: "CE_2" }] }, params).pass).toBe(true);
  });
  it("blocks with too few counter-evidence items", () => {
    expect(adversarialCoverage({ counter_items: [{ id: "CE_1" }] }, params).pass).toBe(false);
  });
});

describe("structure:loop_tease_alignment", () => {
  it("passes when there are no misaligned teases", () => {
    const units = [{ unit_id: "B1", loops: { opens: [] }, tease: { enabled: false } }];
    expect(loopTeaseAlignment({ units }).pass).toBe(true);
  });
  it("blocks when a tease targets the wrong closing beat", () => {
    const units = [
      {
        unit_id: "B1",
        loops: { opens: [{ loop_id: "L1", closes_at: "B3" }] },
        tease: { enabled: true, target_loop: "L1", target_beat: "B5" },
      },
    ];
    const r = loopTeaseAlignment({ units });
    expect(r.pass).toBe(false);
    expect(r.action).toBe("BLOCK");
  });
  it("blocks on invalid units input", () => {
    expect(loopTeaseAlignment({ units: undefined }).pass).toBe(false);
  });
});
