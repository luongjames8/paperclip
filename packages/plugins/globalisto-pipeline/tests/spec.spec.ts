import { describe, expect, it } from "vitest";
import { loadThematicSpec, validateSpec } from "../src/engine/spec.js";
import { KNOWN_GATE_IDS, THEMATIC_STEPS } from "../src/engine/spec-data.js";
import type { StepSpec } from "../src/engine/types.js";

// ── loadThematicSpec ───────────────────────────────────────────────────────────

describe("loadThematicSpec", () => {
  it("returns a non-empty array with more than 40 steps", () => {
    const steps = loadThematicSpec();
    expect(steps.length).toBeGreaterThan(40);
  });

  it("first step is in the discovery module", () => {
    const steps = loadThematicSpec();
    expect(steps[0].id).toMatch(/^discovery:/);
  });

  it("last step is the final assembly step", () => {
    const steps = loadThematicSpec();
    const last = steps[steps.length - 1];
    expect(last.id).toMatch(/^final:/);
  });

  it("every step has a non-empty id and prompt", () => {
    const steps = loadThematicSpec();
    for (const s of steps) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.prompt.length).toBeGreaterThan(0);
    }
  });

  it("every step has inputs and outputs as arrays", () => {
    const steps = loadThematicSpec();
    for (const s of steps) {
      expect(Array.isArray(s.inputs)).toBe(true);
      expect(Array.isArray(s.outputs)).toBe(true);
    }
  });

  it("every step has gatesAfter as an array", () => {
    const steps = loadThematicSpec();
    for (const s of steps) {
      expect(Array.isArray(s.gatesAfter)).toBe(true);
    }
  });
});

// ── KNOWN_GATE_IDS ────────────────────────────────────────────────────────────

describe("KNOWN_GATE_IDS", () => {
  it("is a non-empty array of strings", () => {
    expect(Array.isArray(KNOWN_GATE_IDS)).toBe(true);
    expect(KNOWN_GATE_IDS.length).toBeGreaterThan(0);
    for (const id of KNOWN_GATE_IDS) {
      expect(typeof id).toBe("string");
    }
  });
});

// ── validateSpec (canonical) ──────────────────────────────────────────────────

describe("validateSpec with canonical thematic spec", () => {
  it("returns ok=true for the real canonical spec", () => {
    const result = validateSpec(loadThematicSpec(), KNOWN_GATE_IDS);
    // If this fails, spec-data.ts extraction is wrong — fix the extraction, not the test.
    expect(result.ok).toBe(true);
  });
});

// ── validateSpec (injected violations) ───────────────────────────────────────

describe("validateSpec catches violations", () => {
  function baseSteps(): StepSpec[] {
    return [
      { id: "a:step_1", prompt: "a/1.md", inputs: [], outputs: ["A.yaml"], requiredModel: "sonnet", gatesAfter: [] },
      { id: "b:step_1", prompt: "b/1.md", inputs: ["A.yaml"], outputs: ["B.yaml"], requiredModel: "opus", gatesAfter: [] },
    ];
  }
  const knownGates = ["gate:alpha"];

  it("catches a duplicate step id (ok=false)", () => {
    const steps = baseSteps();
    // Inject duplicate: push a copy of step_1
    steps.push({ id: "a:step_1", prompt: "a/dup.md", inputs: [], outputs: ["C.yaml"], requiredModel: "sonnet", gatesAfter: [] });
    const result = validateSpec(steps, knownGates);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("a:step_1"))).toBe(true);
  });

  it("catches a gatesAfter reference to an unknown gate id (ok=false)", () => {
    const steps = baseSteps();
    steps.push({
      id: "c:step_1",
      prompt: "c/1.md",
      inputs: [],
      outputs: ["C.yaml"],
      requiredModel: "sonnet",
      gatesAfter: ["gate:nonexistent"],
    });
    const result = validateSpec(steps, knownGates);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("gate:nonexistent"))).toBe(true);
  });

  it("catches an ordering violation (input produced only by a later step) (ok=false)", () => {
    // Step order: step1 reads B.yaml, but B.yaml is only produced by step2 (later).
    const steps: StepSpec[] = [
      { id: "a:step_1", prompt: "a/1.md", inputs: ["B.yaml"], outputs: ["A.yaml"], requiredModel: "sonnet", gatesAfter: [] },
      { id: "b:step_1", prompt: "b/1.md", inputs: [], outputs: ["B.yaml"], requiredModel: "opus", gatesAfter: [] },
    ];
    const result = validateSpec(steps, knownGates);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("B.yaml"))).toBe(true);
  });

  it("does not flag external (non-produced) inputs as ok=false violations", () => {
    // external seeds (never produced by any step) should be tolerated — prefixed "external:" but ok stays true
    const steps: StepSpec[] = [
      {
        id: "a:step_1",
        prompt: "a/1.md",
        inputs: ["TOPIC_SEED.yaml"], // never produced
        outputs: ["A.yaml"],
        requiredModel: "sonnet",
        gatesAfter: [],
      },
    ];
    const result = validateSpec(steps, knownGates);
    expect(result.ok).toBe(true);
  });
});
