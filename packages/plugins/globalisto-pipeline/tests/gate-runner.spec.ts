import { describe, expect, it } from "vitest";
import { runLocalGate } from "../src/engine/gate-runner.js";
import { GATE_DEFS } from "../src/engine/spec-data.js";

describe("runLocalGate — local gate dispatch", () => {
  it("dispatches angle:title_length and returns a GateResult", () => {
    const result = runLocalGate(
      "angle:title_length",
      { title: "a b c d e f" },
      { min_words: 5, max_words: 12 },
    );
    expect("deferred" in result).toBe(false);
    if (!("deferred" in result)) {
      expect(result.pass).toBe(true);
      expect(result.action).toBe("CONTINUE");
    }
  });

  it("dispatches research:fetch_count and returns BLOCK on missing data", () => {
    const result = runLocalGate("research:fetch_count", {}, { min_fetches_per_slot: 3 });
    expect("deferred" in result).toBe(false);
    if (!("deferred" in result)) {
      expect(result.pass).toBe(false);
      expect(result.action).toBe("BLOCK");
    }
  });

  it("dispatches research:adversarial_coverage and passes with enough items", () => {
    const result = runLocalGate(
      "research:adversarial_coverage",
      { counter_items: [{ id: "CE_1" }, { id: "CE_2" }] },
      { min_counter_items: 2 },
    );
    expect("deferred" in result).toBe(false);
    if (!("deferred" in result)) {
      expect(result.pass).toBe(true);
    }
  });

  it("dispatches structure:loop_tease_alignment and returns a GateResult", () => {
    const result = runLocalGate("structure:loop_tease_alignment", { units: [] });
    expect("deferred" in result).toBe(false);
    if (!("deferred" in result)) {
      expect(result.pass).toBe(true);
    }
  });

  it("dispatches writing:quote_injection and blocks on missing research", () => {
    const result = runLocalGate("writing:quote_injection", {});
    expect("deferred" in result).toBe(false);
    if (!("deferred" in result)) {
      expect(result.pass).toBe(false);
    }
  });
});

describe("runLocalGate — delegated gate returns deferred", () => {
  it("returns deferred for structure:hook_position (delegated)", () => {
    const result = runLocalGate("structure:hook_position", { retention_structure: "" });
    expect("deferred" in result).toBe(true);
    if ("deferred" in result) {
      expect(result.deferred).toBe(true);
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("returns deferred for structure:retention_coherence (delegated)", () => {
    const result = runLocalGate("structure:retention_coherence", {});
    expect("deferred" in result).toBe(true);
  });

  it("returns deferred for validation:evidence_alignment (delegated)", () => {
    const result = runLocalGate("validation:evidence_alignment", {});
    expect("deferred" in result).toBe(true);
  });

  it("returns deferred for angle:serp_audit (delegated)", () => {
    const result = runLocalGate("angle:serp_audit", { title: "test" });
    expect("deferred" in result).toBe(true);
  });
});

describe("runLocalGate — unknown gate returns deferred", () => {
  it("returns deferred with a reason for a completely unknown gate id", () => {
    const result = runLocalGate("unknown:nonexistent_gate", {});
    expect("deferred" in result).toBe(true);
    if ("deferred" in result) {
      expect(result.deferred).toBe(true);
      expect(typeof result.reason).toBe("string");
    }
  });
});

describe("GATE_DEFS completeness", () => {
  it("contains exactly 24 entries", () => {
    expect(Object.keys(GATE_DEFS).length).toBe(24);
  });

  it("has 10 local gates and 14 delegated gates", () => {
    const entries = Object.values(GATE_DEFS);
    const local = entries.filter((g) => g.type === "local");
    const delegated = entries.filter((g) => g.type === "delegated");
    expect(local.length).toBe(10);
    expect(delegated.length).toBe(14);
  });

  it("maps gate_input_map keys to gateInputMap", () => {
    // angle:title_length has gate_input_map.title in the canonical spec
    expect(GATE_DEFS["angle:title_length"].gateInputMap).toBeDefined();
  });
});
