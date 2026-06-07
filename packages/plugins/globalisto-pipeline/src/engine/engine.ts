// Pure conductor functions — no ctx, no IO, no LLM.
//
// The plugin worker (src/worker.ts) wires these to ctx.db (state) and
// ctx.agents.invoke (per-step worker-agent execution). Keeping the decision
// logic here, pure, is what lets every branch be a vitest unit test with no
// harness — see the architecture doc §5/§6.
//
// SCAFFOLD STATUS: nextStep/advance/resolveWorker are implemented + tested.
// Gate evaluation (the 10 local gates ported from pipeline-mcp gates.js) and
// the ctx-wired conductor loop land in the implementation phase.

import type { ModelProfile, ModelRole, PipelineState, StepResult, StepSpec } from "./types.js";

/** The next step to run, or null when every step is complete. */
export function nextStep(state: PipelineState, steps: StepSpec[]): StepSpec | null {
  const done = new Set(state.completedStepIds);
  return steps.find((step) => !done.has(step.id)) ?? null;
}

/** Advance state after a step completes. Idempotent on stepId. */
export function advance(state: PipelineState, result: StepResult): PipelineState {
  if (state.completedStepIds.includes(result.stepId)) return state;
  return { ...state, completedStepIds: [...state.completedStepIds, result.stepId] };
}

/** Resolve a step's abstract model role to the worker-agent id via the profile. */
export function resolveWorker(role: ModelRole, profile: ModelProfile): string {
  const agentId = profile[role];
  if (!agentId) throw new Error(`No worker agent mapped for model role "${role}" in profile`);
  return agentId;
}
