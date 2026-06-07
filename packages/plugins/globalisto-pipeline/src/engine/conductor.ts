// Pure conductor decision function — no ctx, no I/O, fully unit-testable.
//
// nextAction() maps the current run state to the next action the ctx-wired
// worker (src/worker.ts) should take. All 4 branches are exercised by the
// tests in tests/conductor.spec.ts.

import type { StepSpec } from "./types.js";
import { nextStep } from "./engine.js";

export type RunState = {
  completedStepIds: string[];
  activeStepId: string | null;
  stepComplete: boolean;
};

export type ConductorAction =
  | { kind: "invoke"; step: StepSpec }
  | { kind: "advance"; step: StepSpec }
  | { kind: "wait" }
  | { kind: "complete" };

/**
 * Decide what the conductor should do next for this run.
 *
 * Branch table:
 *   activeStepId set + stepComplete  → advance (gate-check + complete step)
 *   activeStepId set + !stepComplete → wait    (worker still running)
 *   no activeStepId + next exists    → invoke  (dispatch worker)
 *   no activeStepId + no next        → complete
 */
export function nextAction(run: RunState, steps: StepSpec[]): ConductorAction {
  if (run.activeStepId !== null) {
    if (run.stepComplete) {
      const step = steps.find((s) => s.id === run.activeStepId);
      if (!step) throw new Error(`Active step not found in spec: ${run.activeStepId}`);
      return { kind: "advance", step };
    }
    return { kind: "wait" };
  }

  const next = nextStep({ completedStepIds: run.completedStepIds }, steps);
  if (next === null) return { kind: "complete" };
  return { kind: "invoke", step: next };
}
