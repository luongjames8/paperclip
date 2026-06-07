// Pure local-gate implementations, ported from the canonical pipeline-mcp
// gates.js (runLocalGate). No filesystem, no ctx — each gate is a pure function
// over its already-resolved input. The ctx-wired conductor is responsible for
// reading artifact content from issue documents and passing it in; that keeps
// these unit-testable in isolation (see architecture doc §5).

import type { GateResult } from "./types.js";

/** angle:title_length — title within the allowed word range. */
export function titleLength(
  input: { title?: string },
  params: { min_words: number; max_words: number },
): GateResult {
  const title = input.title;
  if (!title) return { pass: false, action: "BLOCK", reasons: ["No title provided"] };
  const wordCount = title.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const { min_words, max_words } = params;
  if (wordCount < min_words) {
    return { pass: false, action: "BLOCK", reasons: [`Title has ${wordCount} words, minimum is ${min_words}`], metrics: { word_count: wordCount } };
  }
  if (wordCount > max_words) {
    return { pass: false, action: "BLOCK", reasons: [`Title has ${wordCount} words, maximum is ${max_words}`], metrics: { word_count: wordCount } };
  }
  return { pass: true, action: "CONTINUE", reasons: [`Title has ${wordCount} words (${min_words}-${max_words} range)`], metrics: { word_count: wordCount } };
}

/** research:fetch_count — every slot has >= the minimum evidence fetches. */
export function fetchCount(
  input: { slots_fetched?: Record<string, number> },
  params: { min_fetches_per_slot: number },
): GateResult {
  const slots = input.slots_fetched;
  const min = params.min_fetches_per_slot;
  if (!slots || typeof slots !== "object") {
    return { pass: false, action: "BLOCK", reasons: ["Missing slots_fetched data"] };
  }
  const failed: string[] = [];
  for (const [slot, count] of Object.entries(slots)) {
    if (count < min) failed.push(`${slot}: ${count} fetches (need ${min})`);
  }
  if (failed.length > 0) {
    return { pass: false, action: "BLOCK", reasons: [`Insufficient fetches for slots: ${failed.join(", ")}`] };
  }
  const n = Object.keys(slots).length;
  return { pass: true, action: "CONTINUE", reasons: [`All ${n} slots have >= ${min} fetches`] };
}

/** research:adversarial_coverage — adversarial track produced enough counter-evidence. */
export function adversarialCoverage(
  input: { counter_items?: unknown[] },
  params: { min_counter_items: number },
): GateResult {
  const items = input.counter_items ?? [];
  const min = params.min_counter_items;
  if (!Array.isArray(items) || items.length < min) {
    return {
      pass: false,
      action: "BLOCK",
      reasons: [`Adversarial track produced ${items.length} counter-evidence items, minimum is ${min}`],
      metrics: { counter_item_count: items.length },
    };
  }
  return {
    pass: true,
    action: "CONTINUE",
    reasons: [`Adversarial track produced ${items.length} counter-evidence items`],
    metrics: { counter_item_count: items.length },
  };
}

interface TeaseUnit {
  unit_id?: string;
  beat_id?: string;
  loops?: { opens?: Array<{ loop_id?: string; closes_at?: string }> };
  tease?: { enabled?: boolean; target_beat?: string; target_loop?: string };
}

/** structure:loop_tease_alignment — teases point to their loop's actual closing beat. */
export function loopTeaseAlignment(input: { units?: TeaseUnit[] }): GateResult {
  const units = input.units;
  if (!units || !Array.isArray(units)) {
    return { pass: false, action: "BLOCK", reasons: ["Missing or invalid units array"] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const unit of units) {
    const beatId = unit.unit_id ?? unit.beat_id;
    const openedLoops = unit.loops?.opens ?? [];
    const tease = unit.tease;
    if (openedLoops.length > 0 && !tease?.enabled) {
      warnings.push(`${beatId}: Opens loop(s) but has no tease`);
    }
    if (tease?.enabled && openedLoops.length > 0) {
      const matching = openedLoops.find((l) => l.loop_id === tease.target_loop && l.closes_at === tease.target_beat);
      if (!matching) {
        const actual = openedLoops.find((l) => l.loop_id === tease.target_loop);
        const actualClose = actual?.closes_at ?? "unknown";
        errors.push(`Tease targets ${tease.target_beat} but loop ${tease.target_loop} closes at ${actualClose}`);
      }
    }
    if (tease?.enabled && openedLoops.length === 0) {
      warnings.push(`${beatId}: Has tease but opens no loops`);
    }
  }
  const hasBlocking = errors.length > 0;
  return {
    pass: !hasBlocking,
    action: hasBlocking ? "BLOCK" : warnings.length > 0 ? "WARN" : "CONTINUE",
    reasons: hasBlocking ? errors : warnings.length > 0 ? warnings : ["All teases correctly target their loop closures"],
    metrics: { errors, warnings },
  };
}
