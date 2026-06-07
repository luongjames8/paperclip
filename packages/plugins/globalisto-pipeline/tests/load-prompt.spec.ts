import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readStepPrompt } from "../src/engine/load-prompt.js";
import { loadThematicSpec } from "../src/engine/spec.js";

// The vendored prompts dir lives at the package root (../prompts relative to tests/),
// the same way the worker resolves it from dist/ at runtime.
const PROMPTS_DIR = fileURLToPath(new URL("../prompts", import.meta.url));

describe("readStepPrompt", () => {
  it("reads a real vendored .md step prompt (path resolves against the bundled prompts)", () => {
    const body = readStepPrompt(PROMPTS_DIR, "discovery/steps/1_recon.md");
    expect(body).toBeTypeOf("string");
    expect((body as string).length).toBeGreaterThan(0);
  });

  it("returns null for a script-only step prompt that isn't a vendored .md (node-exec deferred)", () => {
    expect(readStepPrompt(PROMPTS_DIR, "scripts/packaging_module.js")).toBeNull();
  });

  it("every non-script step in the spec has a readable vendored prompt", () => {
    const missing = loadThematicSpec()
      .filter((s) => !s.prompt.endsWith(".js"))
      .filter((s) => readStepPrompt(PROMPTS_DIR, s.prompt) === null)
      .map((s) => `${s.id} -> ${s.prompt}`);
    expect(missing).toEqual([]);
  });
});
