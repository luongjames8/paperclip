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

// ── Content helpers (ported from canonical gates.js) ──────────────────────────

/** Count narration words, skipping headers, production tags, yaml, rules, code fences. */
export function countNarratorWords(script: string): number {
  let wordCount = 0;
  for (const line of script.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (/^\[.+\]$/.test(trimmed)) continue;
    if (/^[a-z_]+:\s/i.test(trimmed)) continue;
    if (/^[-=]{3,}$/.test(trimmed)) continue;
    if (trimmed.startsWith("```")) continue;
    wordCount += trimmed.split(/\s+/).filter((w) => w.length > 0).length;
  }
  return wordCount;
}

function allSections(content: string): string[] {
  return content.match(/## SECTION \d+[^\n]*\n[\s\S]*?(?=\n## SECTION \d+|$)/gi) ?? [];
}

// ── discard_rate ──────────────────────────────────────────────────────────────

interface DiscardInput {
  selection_mode?: string;
  units_selected?: number;
  promotions_made?: number;
  original_spine_count?: number;
  effective_spine_count?: number;
  minimum_required?: number;
  minimum_met?: boolean;
  spine_material_available?: number;
}

/** structure:discard_rate — selection meets minimum / discard-rate requirements. */
export function discardRate(input: DiscardInput, params: { standard_min: number; comprehensive_min: number }): GateResult {
  const { selection_mode, units_selected } = input;

  // Resolve the effective available count and handle the promotions short-circuit.
  let available: number;
  if ("promotions_made" in input || "original_spine_count" in input) {
    const { original_spine_count, promotions_made = 0, effective_spine_count, minimum_required, minimum_met } = input;
    if (!units_selected || !minimum_required) {
      return { pass: false, action: "BLOCK", reasons: ["Missing units_selected or minimum_required in selection output"] };
    }
    if (promotions_made > 0) {
      if (minimum_met && units_selected >= minimum_required) {
        return { pass: true, action: "CONTINUE", reasons: [`Promoted ${promotions_made} items to meet minimum`, `Selected ${units_selected} beats (minimum: ${minimum_required})`] };
      }
      return { pass: false, action: "BLOCK", reasons: [`Even with ${promotions_made} promotions, only have ${units_selected} beats (need ${minimum_required})`] };
    }
    available = effective_spine_count ?? original_spine_count ?? 0;
  } else {
    const { spine_material_available } = input;
    if (!spine_material_available || !units_selected) {
      return { pass: false, action: "BLOCK", reasons: ["Missing spine_material_available or units_selected"] };
    }
    available = spine_material_available;
  }

  const rate = (available - units_selected!) / available;
  const minDiscard = selection_mode === "comprehensive" ? params.comprehensive_min : params.standard_min;
  if (rate >= minDiscard) {
    return { pass: true, action: "CONTINUE", reasons: [`Discard rate ${(rate * 100).toFixed(1)}% meets minimum ${(minDiscard * 100).toFixed(0)}%`] };
  }
  return { pass: false, action: "BLOCK", reasons: [`Discard rate ${(rate * 100).toFixed(1)}% below minimum ${(minDiscard * 100).toFixed(0)}%`] };
}

// ── quote_injection ───────────────────────────────────────────────────────────

interface ResearchMaster {
  sources?: Array<{ credibility?: string }>;
  evidence?: Array<{ credibility?: string }>;
  data_points?: Array<{ confidence?: string }>;
  quotes?: Array<{ credibility?: string }>;
}

/** writing:quote_injection — RESEARCH_MASTER has >= 10 sources (current or legacy shape). */
export function quoteInjection(input: { research?: ResearchMaster }): GateResult {
  const data = input.research;
  if (!data || typeof data !== "object") {
    return { pass: false, action: "BLOCK", reasons: ["Missing research master object"] };
  }
  let sources = data.sources ?? data.evidence ?? [];
  let count = sources.length;
  let format = "current";
  if (count === 0 && (data.data_points || data.quotes)) {
    const dp = data.data_points ?? [];
    const q = data.quotes ?? [];
    count = dp.length + q.length;
    format = "legacy";
    sources = [...dp.map((d) => ({ credibility: d.confidence })), ...q.map((x) => ({ credibility: x.credibility ?? "medium" }))];
  }
  const minSources = 10;
  const highCred = sources.filter((s) => s.credibility === "high").length;
  if (count >= minSources) {
    return { pass: true, action: "CONTINUE", reasons: [`Found ${count} sources (min: ${minSources}), ${highCred} high-credibility (format: ${format})`], metrics: { total_sources: count, high_credibility_sources: highCred, format } };
  }
  return { pass: false, action: "BLOCK", reasons: [`Insufficient sources: ${count} (need ${minSources})`], metrics: { total_sources: count, format } };
}

// ── hook_length ───────────────────────────────────────────────────────────────

/** writing:hook_length — Section 1 word count under the max. */
export function hookLength(input: { content?: string }, params: { max_words?: number }): GateResult {
  const content = input.content;
  const max = params?.max_words ?? 80;
  if (!content) return { pass: false, action: "BLOCK", reasons: ["No content provided"] };
  const m = content.match(/## SECTION 1[:\s][^\n]*\n([\s\S]*?)(?=\n## SECTION 2|$)/i);
  if (!m) return { pass: false, action: "BLOCK", reasons: ["Section 1 not found in script"] };
  const wordCount = countNarratorWords(m[1]);
  if (wordCount > max) {
    return { pass: false, action: "BLOCK", reasons: [`Section 1 too long: ${wordCount} words (max ${max})`], metrics: { word_count: wordCount, max_allowed: max } };
  }
  return { pass: true, action: "CONTINUE", reasons: [`Section 1 word count OK: ${wordCount} words (max ${max})`], metrics: { section1_words: wordCount } };
}

// ── conclusion_behavior ───────────────────────────────────────────────────────

/** writing:conclusion_behavior — no banned conclusion phrases in the final section. */
export function conclusionBehavior(input: { content?: string }, params: { banned_phrases?: string[] }): GateResult {
  const content = input.content;
  const banned = params?.banned_phrases ?? [];
  if (!content) return { pass: false, action: "BLOCK", reasons: ["No content provided"] };
  const sections = allSections(content);
  if (sections.length === 0) return { pass: false, action: "BLOCK", reasons: ["No sections found in script"] };
  const finalSection = sections[sections.length - 1].toLowerCase();
  const found = banned.filter((p) => finalSection.includes(p.toLowerCase()));
  if (found.length > 0) {
    return { pass: false, action: "BLOCK", reasons: [`Conclusion behavior detected: "${found.join('", "')}"`], metrics: { banned_phrases_found: found } };
  }
  return { pass: true, action: "CONTINUE", reasons: ["No conclusion behavior detected in final section"] };
}

// ── final_length ──────────────────────────────────────────────────────────────

/** writing:final_length — final section word count vs warn/block thresholds. */
export function finalLength(input: { content?: string }, params: { warn_threshold?: number; block_threshold?: number }): GateResult {
  const content = input.content;
  const warn = params?.warn_threshold ?? 60;
  const block = params?.block_threshold ?? 80;
  if (!content) return { pass: false, action: "BLOCK", reasons: ["No content provided"] };
  const sections = allSections(content);
  if (sections.length === 0) return { pass: false, action: "BLOCK", reasons: ["No sections found in script"] };
  const wordCount = countNarratorWords(sections[sections.length - 1]);
  if (wordCount > block) {
    return { pass: false, action: "BLOCK", reasons: [`Final section too long: ${wordCount} words (max ${block})`], metrics: { word_count: wordCount } };
  }
  if (wordCount > warn) {
    return { pass: true, action: "WARN", reasons: [`Final section slightly long: ${wordCount} words (target: ${warn})`], metrics: { word_count: wordCount } };
  }
  return { pass: true, action: "CONTINUE", reasons: [`Final section length OK: ${wordCount} words`], metrics: { final_section_words: wordCount } };
}

// ── punchup_integrity ─────────────────────────────────────────────────────────

/** writing:punchup_integrity — punch-up preserved sections + citations, bounded word delta. */
export function punchupIntegrity(input: { original?: string; punched?: string }, params: { max_word_delta?: number }): GateResult {
  const { original, punched } = input;
  const maxDelta = params?.max_word_delta ?? 0.15;
  if (!original || !punched) {
    return { pass: false, action: "BLOCK", reasons: ["original and punched content both required"] };
  }
  const errors: string[] = [];
  const warnings: string[] = [];

  const origSections = original.match(/## SECTION \d+/gi) ?? [];
  const punchSections = punched.match(/## SECTION \d+/gi) ?? [];
  if (origSections.length !== punchSections.length) {
    errors.push(`Section count changed: ${origSections.length} → ${punchSections.length}`);
  }

  const idSet = (text: string, re: RegExp) => new Set((text.match(re) ?? []).map((id) => id.toLowerCase()));
  const missing = (a: Set<string>, b: Set<string>) => [...a].filter((id) => !b.has(id));

  const missEvidence = missing(idSet(original, /\[dp_\d+\]/gi), idSet(punched, /\[dp_\d+\]/gi));
  if (missEvidence.length > 0) errors.push(`Missing evidence IDs: ${missEvidence.join(", ")}`);
  const missQuotes = missing(idSet(original, /\[q_\d+\]/gi), idSet(punched, /\[q_\d+\]/gi));
  if (missQuotes.length > 0) errors.push(`Missing quote IDs: ${missQuotes.join(", ")}`);

  const ow = countNarratorWords(original);
  const pw = countNarratorWords(punched);
  const delta = Math.abs(pw - ow) / ow;
  if (delta > maxDelta) {
    if (pw < ow) warnings.push(`Word count decreased by ${Math.round(delta * 100)}% (tightening OK but significant)`);
    else errors.push(`Word count increased by ${Math.round(delta * 100)}% (max ${maxDelta * 100}%)`);
  }

  if (errors.length > 0) return { pass: false, action: "BLOCK", reasons: errors, metrics: { warnings } };
  if (warnings.length > 0) return { pass: true, action: "WARN", reasons: warnings };
  return { pass: true, action: "CONTINUE", reasons: ["Punch-up preserved structure and all citations"] };
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
