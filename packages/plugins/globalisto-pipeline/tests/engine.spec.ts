import { describe, expect, it } from "vitest";
import { advance, nextStep, resolveWorker } from "../src/engine/engine.js";
import type { ModelProfile, PipelineState, StepSpec } from "../src/engine/types.js";

const steps: StepSpec[] = [
  { id: "discovery:1", prompt: "discovery/1.md", inputs: [], outputs: ["A.yaml"], requiredModel: "opus", gatesAfter: [] },
  { id: "writing:1", prompt: "writing/1.md", inputs: ["A.yaml"], outputs: ["DRAFT.md"], requiredModel: "sonnet", gatesAfter: [] },
];

function state(completed: string[] = []): PipelineState {
  return { topic: "german_engineering", profile: "mixed", completedStepIds: completed };
}

const mixed: ModelProfile = {
  opus: "globalisto-worker-glm5",
  sonnet: "globalisto-worker-qwen37",
  deepseek: "globalisto-worker-glm5",
};

describe("conductor engine (pure)", () => {
  it("nextStep returns the first incomplete step in order", () => {
    expect(nextStep(state(), steps)?.id).toBe("discovery:1");
    expect(nextStep(state(["discovery:1"]), steps)?.id).toBe("writing:1");
  });

  it("nextStep returns null when all steps are complete", () => {
    expect(nextStep(state(["discovery:1", "writing:1"]), steps)).toBeNull();
  });

  it("advance records completion and is idempotent", () => {
    const s1 = advance(state(), { stepId: "discovery:1", artifacts: ["A.yaml"] });
    expect(s1.completedStepIds).toEqual(["discovery:1"]);
    const s2 = advance(s1, { stepId: "discovery:1", artifacts: ["A.yaml"] });
    expect(s2.completedStepIds).toEqual(["discovery:1"]);
  });

  it("resolveWorker routes a role to its worker agent via the profile", () => {
    expect(resolveWorker("opus", mixed)).toBe("globalisto-worker-glm5");
    expect(resolveWorker("sonnet", mixed)).toBe("globalisto-worker-qwen37");
  });
});
