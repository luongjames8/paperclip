// Pure gate dispatcher — maps local gate ids to their ported implementations in
// gates.ts. Delegated gates and unknown ids return a { deferred: true } sentinel
// so the conductor can log and hand off to the appropriate worker.
//
// The dispatcher takes an already-assembled `input` object; it does NOT read
// artifacts. Input assembly is the conductor's responsibility.

import type { GateResult } from "./types.js";
import {
  titleLength,
  fetchCount,
  adversarialCoverage,
  loopTeaseAlignment,
  discardRate,
  quoteInjection,
  hookLength,
  conclusionBehavior,
  finalLength,
  punchupIntegrity,
} from "./gates.js";
import { GATE_DEFS } from "./spec-data.js";

export type LocalGateOutcome = GateResult | { deferred: true; reason: string };

/**
 * Dispatch a gate check.
 *
 * Returns a `GateResult` for the 10 local gate ids.
 * Returns `{ deferred: true, reason }` for any delegated gate or unknown id —
 * the caller is responsible for logging and routing.
 */
export function runLocalGate(
  gateId: string,
  input: Record<string, unknown>,
  params?: Record<string, unknown>,
): LocalGateOutcome {
  const def = GATE_DEFS[gateId];

  if (!def) {
    return { deferred: true, reason: `Unknown gate id: ${gateId}` };
  }

  if (def.type === "delegated") {
    return { deferred: true, reason: `Gate ${gateId} is delegated and must be handled by a worker agent` };
  }

  // Merge caller-supplied params over the spec defaults so tests can override.
  const resolvedParams = { ...(def.params ?? {}), ...(params ?? {}) } as Record<string, unknown>;

  switch (gateId) {
    case "angle:title_length":
      return titleLength(
        input as { title?: string },
        resolvedParams as { min_words: number; max_words: number },
      );

    case "research:fetch_count":
      return fetchCount(
        input as { slots_fetched?: Record<string, number> },
        resolvedParams as { min_fetches_per_slot: number },
      );

    case "research:adversarial_coverage":
      return adversarialCoverage(
        input as { counter_items?: unknown[] },
        resolvedParams as { min_counter_items: number },
      );

    case "structure:discard_rate":
      return discardRate(
        input as Parameters<typeof discardRate>[0],
        resolvedParams as { standard_min: number; comprehensive_min: number },
      );

    case "structure:loop_tease_alignment":
      return loopTeaseAlignment(input as Parameters<typeof loopTeaseAlignment>[0]);

    case "writing:quote_injection":
      return quoteInjection(input as Parameters<typeof quoteInjection>[0]);

    case "writing:hook_length":
      return hookLength(
        input as Parameters<typeof hookLength>[0],
        resolvedParams as { max_words?: number },
      );

    case "writing:conclusion_behavior":
      return conclusionBehavior(
        input as Parameters<typeof conclusionBehavior>[0],
        resolvedParams as { banned_phrases?: string[] },
      );

    case "writing:final_length":
      return finalLength(
        input as Parameters<typeof finalLength>[0],
        resolvedParams as { warn_threshold?: number; block_threshold?: number },
      );

    case "writing:punchup_integrity":
      return punchupIntegrity(
        input as { original?: string; punched?: string },
        resolvedParams as { max_word_delta?: number },
      );

    default:
      // This branch is only reachable if GATE_DEFS has a local gate without a
      // corresponding case — a compile-time oversight, not a runtime expectation.
      return { deferred: true, reason: `No implementation for local gate: ${gateId}` };
  }
}
