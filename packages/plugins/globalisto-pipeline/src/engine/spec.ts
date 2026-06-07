/**
 * Spec loader and structural validator for the globalisto thematic pipeline.
 *
 * loadThematicSpec() — returns the vendored canonical step sequence.
 * validateSpec()     — pure structural checks; no I/O.
 */

import type { StepSpec } from "./types.js";
import { THEMATIC_STEPS } from "./spec-data.js";

/** Returns the canonical thematic step sequence (the vendored THEMATIC_STEPS array). */
export function loadThematicSpec(): StepSpec[] {
  return THEMATIC_STEPS;
}

export interface SpecValidationResult {
  ok: boolean;
  /** Hard errors that indicate a broken or malformed spec. */
  errors: string[];
}

/**
 * Validates a step sequence for structural integrity. Pure — no I/O.
 *
 * Checks performed:
 * (a) No duplicate step ids → ok=false if found.
 * (b) Every gate id in gatesAfter is present in knownGateIds → ok=false if unknown.
 * (c) No ordering violation: an input file produced ONLY by a later step → ok=false.
 *     Inputs that are never produced by any step are treated as external seeds and
 *     reported as "external:<file>" entries but do NOT set ok=false.
 */
export function validateSpec(
  steps: StepSpec[],
  knownGateIds: string[]
): SpecValidationResult {
  const errors: string[] = [];

  // (a) Duplicate step ids
  const seenIds = new Set<string>();
  for (const step of steps) {
    if (seenIds.has(step.id)) {
      errors.push(`duplicate step id: "${step.id}"`);
    }
    seenIds.add(step.id);
  }

  // (b) Unknown gate ids
  const gateSet = new Set(knownGateIds);
  for (const step of steps) {
    for (const gateId of step.gatesAfter) {
      if (!gateSet.has(gateId)) {
        errors.push(`step "${step.id}" references unknown gate "${gateId}"`);
      }
    }
  }

  // (c) Ordering violations: build an index of which step index each output is
  // first produced at, then check whether any input for step[i] is produced ONLY
  // by a step with index > i (downstream only).
  //
  // A file produced at both upstream AND downstream positions is not a violation
  // (the earlier producer satisfies the dependency).
  //
  // Files that are never produced at all → external seeds → "external:" warning,
  // does NOT set ok=false.

  // Map: filename → first step index that produces it
  const firstProducedAt = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    for (const out of steps[i].outputs) {
      if (!firstProducedAt.has(out)) {
        firstProducedAt.set(out, i);
      }
    }
  }

  // Set of all files produced somewhere
  const allProduced = new Set<string>();
  for (const step of steps) {
    for (const out of step.outputs) {
      allProduced.add(out);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    for (const inp of step.inputs) {
      const producedAt = firstProducedAt.get(inp);
      if (producedAt === undefined) {
        // Never produced by any step in this sequence — external seed. Warn but do not error.
        errors.push(`external:${inp} (consumed by "${step.id}", not produced by any step)`);
      } else if (producedAt > i) {
        // Ordering violation: only produced downstream of this step.
        errors.push(
          `ordering violation: step "${step.id}" at index ${i} reads "${inp}" which is first produced at index ${producedAt} (downstream)`
        );
      }
    }
  }

  // ok=false only for hard errors (duplicate id, unknown gate, ordering violation)
  // "external:" entries are informational — check if any non-external error exists.
  const hardErrors = errors.filter((e) => !e.startsWith("external:"));
  return { ok: hardErrors.length === 0, errors };
}
