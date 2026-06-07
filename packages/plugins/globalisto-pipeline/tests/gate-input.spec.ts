import { describe, expect, it } from "vitest";
import { assembleGateInput } from "../src/engine/gate-input.js";

// ── assembleGateInput — pure unit tests ──────────────────────────────────────

describe("assembleGateInput — no map", () => {
  it("returns {} when gateInputMap is undefined", () => {
    expect(assembleGateInput(undefined, {})).toEqual({});
  });

  it("returns {} when gateInputMap is empty", () => {
    expect(assembleGateInput({}, { "some.yaml": "content" })).toEqual({});
  });
});

describe("assembleGateInput — key extraction", () => {
  const yaml = `angle_lock:\n  title: "The Big Secret of German Engineering"\n  ecosystem: automotive`;

  it("extracts a nested dotted key from a YAML artifact", () => {
    const result = assembleGateInput(
      { title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" } },
      { "ANGLE_LOCK.yaml": yaml },
    );
    expect(result.title).toBe("The Big Secret of German Engineering");
  });

  it("extracts a flat dotted key one level deep", () => {
    const flat = `slots_fetched:\n  slot_a: 5\n  slot_b: 3`;
    const result = assembleGateInput(
      { slots_fetched: { file: "STEP2_evidence.yaml", key: "slots_fetched" } },
      { "STEP2_evidence.yaml": flat },
    );
    // The value is the sub-block text
    expect(typeof result.slots_fetched).toBe("string");
    expect(result.slots_fetched as string).toContain("slot_a");
  });

  it("returns {} when a required key is missing from the artifact", () => {
    const result = assembleGateInput(
      { title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" } },
      { "ANGLE_LOCK.yaml": "no_title_here: true" },
    );
    expect(result).toEqual({});
  });
});

describe("assembleGateInput — yaml_dump passthrough", () => {
  it("passes raw artifact string for format: yaml_dump", () => {
    const raw = "retention_structure:\n  beats: []\n";
    const result = assembleGateInput(
      { retention_structure: { file: "RETENTION_STRUCTURE.yaml", format: "yaml_dump" } },
      { "RETENTION_STRUCTURE.yaml": raw },
    );
    expect(result.retention_structure).toBe(raw);
  });

  it("passes raw artifact string for format: full_content", () => {
    const raw = "## Some heading\ncontent here";
    const result = assembleGateInput(
      { description: { file: "YOUTUBE_DESCRIPTION.md", format: "full_content" } },
      { "YOUTUBE_DESCRIPTION.md": raw },
    );
    expect(result.description).toBe(raw);
  });
});

describe("assembleGateInput — first_section", () => {
  it("extracts the first markdown section for format: first_section", () => {
    const content = "## SECTION 1: Hook\nOpening line.\n\n## SECTION 2: Body\nBody content.";
    const result = assembleGateInput(
      { opening_text: { file: "DRAFT_CONTENT.md", format: "first_section" } },
      { "DRAFT_CONTENT.md": content },
    );
    expect(result.opening_text as string).toContain("Opening line.");
    expect(result.opening_text as string).not.toContain("Body content.");
  });
});

describe("assembleGateInput — optional missing", () => {
  it("omits an optional input when its artifact is absent", () => {
    const result = assembleGateInput(
      {
        required_key: { file: "PRESENT.yaml", key: "value" },
        optional_key: { file: "MISSING.yaml", key: "value", optional: true },
      },
      { "PRESENT.yaml": "value: hello" },
    );
    expect(result.required_key).toBe("hello");
    expect("optional_key" in result).toBe(false);
  });

  it("returns {} when a required artifact is missing", () => {
    const result = assembleGateInput(
      { required_key: { file: "MISSING.yaml", key: "value" } },
      {},
    );
    expect(result).toEqual({});
  });
});

describe("assembleGateInput — special inputs skipped", () => {
  it("silently skips special inputs (pipeline_dir)", () => {
    const result = assembleGateInput(
      { pipeline_dir: { special: "pipeline_dir" } },
      {},
    );
    expect(result).toEqual({});
  });

  it("skips special and assembles remaining inputs", () => {
    const result = assembleGateInput(
      {
        pipeline_dir: { special: "pipeline_dir" },
        title: { file: "ANGLE_LOCK.yaml", key: "title" },
      },
      { "ANGLE_LOCK.yaml": "title: Hello World" },
    );
    expect("pipeline_dir" in result).toBe(false);
    expect(result.title).toBe("Hello World");
  });
});
