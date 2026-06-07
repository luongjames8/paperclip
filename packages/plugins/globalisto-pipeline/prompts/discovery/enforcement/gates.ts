/**
 * Discovery Module Enforcement - Deterministic Gates
 *
 * Gate functions that enforce pipeline rules. Claude MUST respect gate results.
 * These are deterministic checks - no LLM reasoning, pure threshold logic.
 *
 * Usage via CLI:
 *   npx ts-node gates.ts <gate-name> '<json-input>'
 *
 * Returns JSON: { pass: boolean, reasons: string[], override?: {...}, action?: {...} }
 */

import type {
  GateResult,
  GateAction,
  DiscourseItem,
  CandidateBelief,
  BonafideScore,
  InterestScore,
  ValidationDecision,
  SurvivalResult,
  NoveltyRating,
} from './types.js';

// =============================================================================
// CONFIGURATION DEFAULTS
// =============================================================================

export const DEFAULT_THRESHOLDS = {
  sufficiency: {
    min_items: 25,           // Up from 15 - feeds belief funnel
    min_reddit_forum: 8,     // Up from 5 - first-person voices
    min_fetched: 5,          // Up from 3 - depth
    min_source_types: 4,     // Up from 3 - diversity
    max_iterations: 3,
  },
  bonafide: {
    min_sincere_high: 3,
    min_sources_high: 2,
    min_sincere_medium: 1,
  },
  refinement: {
    max_qualifier_words: 3,
    banned_qualifiers: ['sometimes', 'often', 'usually', 'generally', 'tends to'],
  },
  shape: {
    banned_forms: [
      /^(It is|This is) (good|bad|wrong|right)/i,
      /should be/i,
      /is like .+ because/i, // analogies
      /morally/i,
      /ethically/i,
    ],
  },
};

// =============================================================================
// GATE: SUFFICIENCY (After 2b)
// =============================================================================

export interface SufficiencyInput {
  discourse_items: DiscourseItem[];
  iteration: number;
  config?: {
    min_items?: number;
    min_reddit_forum?: number;
    min_fetched?: number;
    min_source_types?: number;
    max_iterations?: number;
  };
}

/**
 * Check if we have sufficient discourse items to proceed
 */
export function gateSufficiency(input: SufficiencyInput): GateResult {
  const config = { ...DEFAULT_THRESHOLDS.sufficiency, ...input.config };
  const items = input.discourse_items;
  const reasons: string[] = [];

  // Count by source type
  const sourceTypeCounts: Record<string, number> = {};
  let redditForumCount = 0;
  let fetchedCount = 0;

  for (const item of items) {
    sourceTypeCounts[item.source_type] = (sourceTypeCounts[item.source_type] || 0) + 1;
    if (item.source_type === 'reddit' || item.source_type === 'forum') {
      redditForumCount++;
    }
    if (item.source_type === 'article' || item.source_type === 'blog' || item.source_type === 'wiki') {
      fetchedCount++;
    }
  }

  const sourceTypes = Object.keys(sourceTypeCounts).length;

  // Check thresholds
  const checks = [
    {
      pass: items.length >= config.min_items,
      reason: `Item count: ${items.length}/${config.min_items}`,
    },
    {
      pass: redditForumCount >= config.min_reddit_forum,
      reason: `Reddit/forum items: ${redditForumCount}/${config.min_reddit_forum}`,
    },
    {
      pass: fetchedCount >= config.min_fetched,
      reason: `Fetched items: ${fetchedCount}/${config.min_fetched}`,
    },
    {
      pass: sourceTypes >= config.min_source_types,
      reason: `Source types: ${sourceTypes}/${config.min_source_types}`,
    },
  ];

  for (const check of checks) {
    reasons.push(check.pass ? `OK: ${check.reason}` : `FAIL: ${check.reason}`);
  }

  const allPass = checks.every((c) => c.pass);

  // Determine action
  let action: GateAction;
  if (allPass) {
    action = { type: 'CONTINUE' };
  } else if (input.iteration >= config.max_iterations) {
    action = { type: 'STOP', reason: `Max iterations (${config.max_iterations}) reached` };
  } else {
    action = { type: 'LOOP', target: '2a', max_iterations: config.max_iterations };
  }

  return {
    gate: 'sufficiency',
    pass: allPass,
    reasons,
    action,
  };
}

// =============================================================================
// GATE: NOVELTY (After 2d)
// =============================================================================

export interface NoveltyInput {
  novelty_ratings: Array<{ belief_id: string; novelty: NoveltyRating }>;
  iteration: number;
  max_iterations?: number;
}

/**
 * Check if we have interesting beliefs or should continue searching
 */
export function gateNovelty(input: NoveltyInput): GateResult {
  const maxIterations = input.max_iterations ?? 3;
  const hasInteresting = input.novelty_ratings.some((r) => r.novelty === 'INTERESTING');
  const reasons: string[] = [];

  const interestingCount = input.novelty_ratings.filter((r) => r.novelty === 'INTERESTING').length;
  const predictableCount = input.novelty_ratings.filter((r) => r.novelty === 'PREDICTABLE').length;

  reasons.push(`Interesting beliefs: ${interestingCount}`);
  reasons.push(`Predictable beliefs: ${predictableCount}`);
  reasons.push(`Iteration: ${input.iteration}/${maxIterations}`);

  let action: GateAction;
  if (hasInteresting) {
    action = { type: 'CONTINUE' };
    reasons.push('Found INTERESTING beliefs - proceeding');
  } else if (input.iteration >= maxIterations) {
    action = { type: 'CONTINUE' };
    reasons.push('Max iterations reached - proceeding with PREDICTABLE beliefs');
  } else {
    action = { type: 'LOOP', target: '2a', max_iterations: maxIterations };
    reasons.push('No INTERESTING beliefs - searching again');
  }

  return {
    gate: 'novelty',
    pass: hasInteresting || input.iteration >= maxIterations,
    reasons,
    action,
  };
}

// =============================================================================
// GATE: BONAFIDE (After 4d)
// =============================================================================

export interface BonafideInput {
  bonafide: BonafideScore;
  interest: InterestScore;
  llm_decision: ValidationDecision;
}

/**
 * Enforce bonafide decision - LOW bonafide or LOW interest = NO-GO
 */
export function gateBonafide(input: BonafideInput): GateResult {
  const { bonafide, interest, llm_decision } = input;
  const reasons: string[] = [];
  let override: GateResult['override'];
  let correctedDecision = llm_decision;

  reasons.push(`Bonafide level: ${bonafide.level}`);
  reasons.push(`Interest level: ${interest.level}`);
  reasons.push(`LLM decision: ${llm_decision}`);

  // Rule 1: LOW bonafide = NO-GO (unconditional)
  if (bonafide.level === 'LOW') {
    if (llm_decision !== 'NO-GO') {
      override = {
        field: 'decision',
        original_value: llm_decision,
        new_value: 'NO-GO',
      };
      correctedDecision = 'NO-GO';
      reasons.push('OVERRIDE: LOW bonafide forces NO-GO');
    }
  }

  // Rule 2: LOW interest = NO-GO (unconditional)
  if (interest.level === 'LOW') {
    if (llm_decision !== 'NO-GO') {
      override = {
        field: 'decision',
        original_value: llm_decision,
        new_value: 'NO-GO',
      };
      correctedDecision = 'NO-GO';
      reasons.push('OVERRIDE: LOW interest forces NO-GO');
    }
  }

  const pass = correctedDecision !== 'NO-GO';

  return {
    gate: 'bonafide',
    pass,
    reasons,
    override,
    action: pass ? { type: 'CONTINUE' } : { type: 'STOP', reason: 'Bonafide gate failed' },
  };
}

// =============================================================================
// GATE: INTERESTING VETO (After 4d)
// =============================================================================

export interface InterestingVetoInput {
  all_candidates: CandidateBelief[];
  current_candidate_id: string;
  current_novelty: NoveltyRating;
}

/**
 * If INTERESTING candidates exist, veto PREDICTABLE candidates
 */
export function gateInterestingVeto(input: InterestingVetoInput): GateResult {
  const { all_candidates, current_candidate_id, current_novelty } = input;
  const reasons: string[] = [];

  const interestingExists = all_candidates.some(
    (c) => c.novelty === 'INTERESTING' && c.id !== current_candidate_id
  );

  reasons.push(`Current candidate novelty: ${current_novelty}`);
  reasons.push(`Other INTERESTING candidates exist: ${interestingExists}`);

  if (current_novelty === 'PREDICTABLE' && interestingExists) {
    reasons.push('VETO: PREDICTABLE candidate deprioritized (INTERESTING exists)');
    return {
      gate: 'interesting_veto',
      pass: false,
      reasons,
      action: { type: 'STOP', reason: 'INTERESTING candidates take priority' },
    };
  }

  return {
    gate: 'interesting_veto',
    pass: true,
    reasons,
    action: { type: 'CONTINUE' },
  };
}

// =============================================================================
// GATE: SURVIVAL (After 5c)
// =============================================================================

export interface SurvivalInput {
  survival_result: SurvivalResult;
}

/**
 * Validate survival verdict consistency
 */
export function gateSurvival(input: SurvivalInput): GateResult {
  const { survival_result } = input;
  const reasons: string[] = [];
  let override: GateResult['override'];

  const strongCount = survival_result.strong_invalidator_count;
  const verdict = survival_result.verdict;

  reasons.push(`Strong invalidators: ${strongCount}`);
  reasons.push(`LLM verdict: ${verdict}`);

  // Rule: 2+ STRONG invalidators should result in KILLED or WOUNDED
  if (strongCount >= 2 && verdict === 'SURVIVES') {
    override = {
      field: 'verdict',
      original_value: verdict,
      new_value: 'WOUNDED',
    };
    reasons.push('OVERRIDE: 2+ STRONG invalidators cannot result in SURVIVES');
  }

  // Rule: 3+ STRONG invalidators should result in KILLED
  if (strongCount >= 3 && verdict !== 'KILLED') {
    override = {
      field: 'verdict',
      original_value: verdict,
      new_value: 'KILLED',
    };
    reasons.push('OVERRIDE: 3+ STRONG invalidators force KILLED');
  }

  const pass = survival_result.verdict !== 'KILLED' && !override?.new_value?.toString().includes('KILLED');

  return {
    gate: 'survival',
    pass,
    reasons,
    override,
    action: pass ? { type: 'CONTINUE' } : { type: 'STOP', reason: 'Belief killed' },
  };
}

// =============================================================================
// GATE: REFINEMENT SHARPNESS (After 5c, if WOUNDED)
// =============================================================================

export interface RefinementInput {
  original_belief: string;
  refined_belief: string;
}

/**
 * Ensure refined belief is sharper, not vaguer
 */
export function gateRefinementSharpness(input: RefinementInput): GateResult {
  const { original_belief, refined_belief } = input;
  const reasons: string[] = [];
  const config = DEFAULT_THRESHOLDS.refinement;

  // Check for vague qualifiers
  let qualifierCount = 0;
  for (const qualifier of config.banned_qualifiers) {
    if (refined_belief.toLowerCase().includes(qualifier)) {
      qualifierCount++;
      reasons.push(`Contains vague qualifier: "${qualifier}"`);
    }
  }

  // Check length increase (refinement shouldn't make belief much longer)
  const lengthRatio = refined_belief.length / original_belief.length;
  if (lengthRatio > 1.5) {
    reasons.push(`Refined belief is ${Math.round((lengthRatio - 1) * 100)}% longer - may be adding hedges`);
  }

  // Check for hedge patterns
  const hedgePatterns = [
    /in (some|many|most) cases/i,
    /depending on/i,
    /it (could|might|may) be/i,
    /to some (extent|degree)/i,
  ];

  for (const pattern of hedgePatterns) {
    if (pattern.test(refined_belief) && !pattern.test(original_belief)) {
      reasons.push(`Added hedge pattern: ${pattern.source}`);
    }
  }

  const pass = qualifierCount < config.max_qualifier_words && lengthRatio <= 1.5;

  if (!pass) {
    reasons.push('Refined belief fails sharpness check - forcing KILLED');
    return {
      gate: 'refinement_sharpness',
      pass: false,
      reasons,
      override: {
        field: 'verdict',
        original_value: 'WOUNDED',
        new_value: 'KILLED',
      },
      action: { type: 'OVERRIDE', field: 'verdict', value: 'KILLED' },
    };
  }

  reasons.push('Refined belief passes sharpness check');
  return {
    gate: 'refinement_sharpness',
    pass: true,
    reasons,
    action: { type: 'CONTINUE' },
  };
}

// =============================================================================
// GATE: SHAPE (Before 6a)
// =============================================================================

export interface ShapeInput {
  belief: string;
}

/**
 * Check belief doesn't have banned forms (moral verdicts, analogies, etc.)
 */
export function gateShape(input: ShapeInput): GateResult {
  const { belief } = input;
  const reasons: string[] = [];
  const bannedForms = DEFAULT_THRESHOLDS.shape.banned_forms;

  const violations: string[] = [];
  for (const pattern of bannedForms) {
    if (pattern.test(belief)) {
      violations.push(pattern.source);
    }
  }

  if (violations.length > 0) {
    reasons.push(`Banned form violations: ${violations.join(', ')}`);
    return {
      gate: 'shape',
      pass: false,
      reasons,
      action: { type: 'BLOCK', reason: 'Belief has banned form - requires reformulation' },
    };
  }

  reasons.push('Belief shape is valid');
  return {
    gate: 'shape',
    pass: true,
    reasons,
    action: { type: 'CONTINUE' },
  };
}

// =============================================================================
// GATE: ALL KILLED (After Phase 5)
// =============================================================================

export interface AllKilledInput {
  survival_results: SurvivalResult[];
  coverage_changed: boolean;
  retry_count: number;
  max_retries?: number;
}

/**
 * Check if all candidates were killed
 */
export function gateAllKilled(input: AllKilledInput): GateResult {
  const { survival_results, coverage_changed, retry_count } = input;
  const maxRetries = input.max_retries ?? 2;
  const reasons: string[] = [];

  const survivors = survival_results.filter((r) => r.verdict !== 'KILLED');
  const allKilled = survivors.length === 0;

  reasons.push(`Survivors: ${survivors.length}/${survival_results.length}`);
  reasons.push(`Coverage changed: ${coverage_changed}`);
  reasons.push(`Retry count: ${retry_count}/${maxRetries}`);

  if (!allKilled) {
    return {
      gate: 'all_killed',
      pass: true,
      reasons,
      action: { type: 'CONTINUE' },
    };
  }

  // All killed - decide whether to retry
  if (coverage_changed && retry_count < maxRetries) {
    reasons.push('All killed but coverage changed - retrying');
    return {
      gate: 'all_killed',
      pass: false,
      reasons,
      action: { type: 'LOOP', target: 'PHASE_1', max_iterations: maxRetries },
    };
  }

  reasons.push('All candidates killed - pipeline fails');
  return {
    gate: 'all_killed',
    pass: false,
    reasons,
    action: { type: 'BLOCK', reason: 'No viable beliefs found for this topic' },
  };
}

// =============================================================================
// GATE REGISTRY
// =============================================================================

export type GateName = keyof typeof gateRegistry;

const gateRegistry = {
  sufficiency: gateSufficiency,
  novelty: gateNovelty,
  bonafide: gateBonafide,
  interesting_veto: gateInterestingVeto,
  survival: gateSurvival,
  refinement_sharpness: gateRefinementSharpness,
  shape: gateShape,
  all_killed: gateAllKilled,
};

/**
 * Run a gate by name
 */
export function runGate(gateName: GateName, input: unknown): GateResult {
  const gateFn = gateRegistry[gateName];
  if (!gateFn) {
    throw new Error(`Unknown gate: ${gateName}`);
  }
  return gateFn(input as never);
}

// =============================================================================
// CLI INTERFACE
// =============================================================================

if (process.argv[1]?.includes('gates')) {
  const [, , gateName, inputJson] = process.argv;

  if (!gateName || !inputJson) {
    console.log('Usage: npx ts-node gates.ts <gate-name> \'<json-input>\'');
    console.log('');
    console.log('Available gates:');
    for (const name of Object.keys(gateRegistry)) {
      console.log(`  - ${name}`);
    }
    process.exit(1);
  }

  try {
    const input = JSON.parse(inputJson);
    const result = runGate(gateName as GateName, input);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
