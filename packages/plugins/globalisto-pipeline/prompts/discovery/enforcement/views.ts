/**
 * Discovery Module Enforcement - Restricted Views
 *
 * Builds restricted views of data for each step.
 * Prevents LLM from seeing information it shouldn't use for a given decision.
 *
 * Role separation is critical to prevent rationalization:
 * - Classification steps shouldn't see validation scores
 * - Decision steps shouldn't see raw discourse
 * - Interest evaluation shouldn't see bonafide scores
 */

import type {
  ContextPack,
  DiscourseItem,
  CandidateBelief,
  ExpectedBelief,
  FoundBelief,
  BonafideScore,
  InterestScore,
  ClassifiedItem,
  Invalidator,
} from './types.js';

// =============================================================================
// VIEW DEFINITIONS
// =============================================================================

/**
 * Step 2c: Identify Beliefs
 * INCLUDES: discourse_items
 * EXCLUDES: expected_beliefs, topic_framing
 */
export interface View2c {
  discourse_items: DiscourseItem[];
}

/**
 * Step 3a: Match Beliefs
 * INCLUDES: expected_beliefs, found_beliefs
 * EXCLUDES: discourse_items (prevent anchoring on raw data)
 */
export interface View3a {
  expected_beliefs: ExpectedBelief[];
  found_beliefs: FoundBelief[];
}

/**
 * Step 4a: Classify Item
 * INCLUDES: single item, belief_context
 * EXCLUDES: other items, any scores
 */
export interface View4a {
  item: DiscourseItem;
  belief_context: string; // The belief being validated
}

/**
 * Step 4b: Score Bonafide
 * INCLUDES: belief, classifications
 * EXCLUDES: interest_score, decisions
 */
export interface View4b {
  belief: string;
  classifications: ClassifiedItem[];
}

/**
 * Step 4c: Evaluate Interest
 * INCLUDES: belief, discourse_items, source_path
 * EXCLUDES: bonafide_score, classifications (prevent anchoring)
 */
export interface View4c {
  belief: string;
  discourse_items: DiscourseItem[];
  source_path: 'top_down_only' | 'bottom_up_only' | 'intersection';
  novelty: 'PREDICTABLE' | 'INTERESTING';
}

/**
 * Step 4d: Make Decision
 * INCLUDES: scores, counts, histogram summary
 * EXCLUDES: raw discourse, full artifacts
 */
export interface View4d {
  belief: string;
  bonafide: BonafideScore;
  interest: InterestScore;
  source_path: 'top_down_only' | 'bottom_up_only' | 'intersection';
  novelty: 'PREDICTABLE' | 'INTERESTING';
  item_count: number;
  classification_summary: {
    sincere: number;
    strawman: number;
    neutral: number;
  };
}

/**
 * Step 5c: Evaluate Survival
 * INCLUDES: belief, invalidators
 * EXCLUDES: discourse_items, validation_scores
 */
export interface View5c {
  belief: string;
  invalidators: Invalidator[];
}

// =============================================================================
// VIEW BUILDERS
// =============================================================================

/**
 * Build view for step 2c
 */
export function buildView2c(items: DiscourseItem[]): View2c {
  return {
    discourse_items: items.map((item) => ({
      ...item,
      // Optionally redact URLs to prevent LLM from making judgments based on source
    })),
  };
}

/**
 * Build view for step 3a
 */
export function buildView3a(
  expectedBeliefs: ExpectedBelief[],
  foundBeliefs: FoundBelief[]
): View3a {
  return {
    expected_beliefs: expectedBeliefs,
    found_beliefs: foundBeliefs.map((b) => ({
      ...b,
      // Don't include supporting_items detail - just the belief
    })),
  };
}

/**
 * Build view for step 4a (per item)
 */
export function buildView4a(
  item: DiscourseItem,
  beliefContext: string
): View4a {
  return {
    item,
    belief_context: beliefContext,
  };
}

/**
 * Build view for step 4b
 */
export function buildView4b(
  belief: string,
  classifications: ClassifiedItem[]
): View4b {
  return {
    belief,
    classifications: classifications.map((c) => ({
      ...c,
      // Keep full classification data
    })),
  };
}

/**
 * Build view for step 4c
 */
export function buildView4c(
  candidate: CandidateBelief,
  discourseItems: DiscourseItem[]
): View4c {
  // Only include items that support this belief
  const relevantItems = discourseItems.filter((item) =>
    candidate.supporting_items.includes(item.id)
  );

  return {
    belief: candidate.belief,
    discourse_items: relevantItems,
    source_path: candidate.source_path,
    novelty: candidate.novelty,
  };
}

/**
 * Build view for step 4d
 */
export function buildView4d(
  candidate: CandidateBelief,
  bonafide: BonafideScore,
  interest: InterestScore,
  classifications: ClassifiedItem[]
): View4d {
  return {
    belief: candidate.belief,
    bonafide,
    interest,
    source_path: candidate.source_path,
    novelty: candidate.novelty,
    item_count: classifications.length,
    classification_summary: {
      sincere: classifications.filter((c) => c.classification === 'SINCERE').length,
      strawman: classifications.filter((c) => c.classification === 'STRAWMAN').length,
      neutral: classifications.filter((c) => c.classification === 'NEUTRAL').length,
    },
  };
}

/**
 * Build view for step 5c
 */
export function buildView5c(
  belief: string,
  invalidators: Invalidator[]
): View5c {
  return {
    belief,
    invalidators,
  };
}

// =============================================================================
// CONTEXT PACK BUILDER
// =============================================================================

/**
 * Build a minimal context pack for a step
 * Only includes what the step needs
 */
export function buildContextPack(
  base: Partial<ContextPack>,
  stepId: string
): ContextPack {
  const pack: ContextPack = {
    topic: base.topic ?? '',
    mode: base.mode ?? 'topic_first',
    iteration: base.iteration ?? 1,
    phase: parseInt(stepId[0], 10),
    step_id: stepId,
    time_window_months: base.time_window_months ?? 12,
    audience_context: base.audience_context,
    active_candidates: [],
    discourse_items_summary: [],
    gate_results: [],
    verifier_results: [],
  };

  // Add step-specific context
  switch (stepId) {
    case '1a':
    case '1b':
      // Top-down generation: need topic and audience only
      break;

    case '2a':
      // Query generation: may need previous queries
      pack.iteration = base.iteration ?? 1;
      break;

    case '2b':
    case '2c':
    case '2d':
      // Bottom-up extraction: need iteration context
      pack.iteration = base.iteration ?? 1;
      break;

    case '3a':
    case '3b':
      // Fusion: need belief lists (handled separately)
      break;

    case '4a':
    case '4b':
    case '4c':
    case '4d':
      // Validation: need candidate context
      if (base.active_candidates) {
        pack.active_candidates = base.active_candidates;
      }
      break;

    case '5a':
    case '5b':
    case '5c':
      // Invalidation: need belief under test
      if (base.active_candidates) {
        pack.active_candidates = base.active_candidates;
      }
      break;

    case '6a':
    case '6b':
    case '6c':
      // Slot generation: need surviving belief
      if (base.active_candidates) {
        pack.active_candidates = base.active_candidates;
      }
      break;
  }

  return pack;
}

// =============================================================================
// REDACTION UTILITIES
// =============================================================================

/**
 * Redact sensitive fields from an object
 */
export function redact<T extends object>(
  obj: T,
  fieldsToRedact: (keyof T)[]
): Partial<T> {
  const result = { ...obj };
  for (const field of fieldsToRedact) {
    delete result[field];
  }
  return result;
}

/**
 * Create a summary of discourse items (for context without full data)
 */
export function summarizeDiscourseItems(items: DiscourseItem[]): {
  total: number;
  by_source_type: Record<string, number>;
  hot_count: number;
  date_range?: { earliest: string; latest: string };
} {
  const bySourceType: Record<string, number> = {};
  let hotCount = 0;
  const dates: string[] = [];

  for (const item of items) {
    bySourceType[item.source_type] = (bySourceType[item.source_type] || 0) + 1;
    if (item.is_hot) hotCount++;
    if (item.date) dates.push(item.date);
  }

  dates.sort();

  return {
    total: items.length,
    by_source_type: bySourceType,
    hot_count: hotCount,
    date_range: dates.length > 0
      ? { earliest: dates[0], latest: dates[dates.length - 1] }
      : undefined,
  };
}

/**
 * Create a summary of candidates (for decision context)
 */
export function summarizeCandidates(candidates: CandidateBelief[]): {
  total: number;
  by_source_path: Record<string, number>;
  by_novelty: Record<string, number>;
} {
  const bySourcePath: Record<string, number> = {};
  const byNovelty: Record<string, number> = {};

  for (const candidate of candidates) {
    bySourcePath[candidate.source_path] = (bySourcePath[candidate.source_path] || 0) + 1;
    byNovelty[candidate.novelty] = (byNovelty[candidate.novelty] || 0) + 1;
  }

  return {
    total: candidates.length,
    by_source_path: bySourcePath,
    by_novelty: byNovelty,
  };
}

// =============================================================================
// STEP-SPECIFIC RESTRICTED DATA BUILDERS
// =============================================================================

/**
 * Get restricted data for a specific step
 * This is the main interface for the runner
 */
export function getRestrictedDataForStep(
  stepId: string,
  fullData: {
    topic?: string;
    audience_context?: string;
    discourse_items?: DiscourseItem[];
    expected_beliefs?: ExpectedBelief[];
    found_beliefs?: FoundBelief[];
    candidates?: CandidateBelief[];
    current_candidate?: CandidateBelief;
    current_item?: DiscourseItem;
    classifications?: ClassifiedItem[];
    bonafide?: BonafideScore;
    interest?: InterestScore;
    invalidators?: Invalidator[];
    iteration?: number;
  }
): unknown {
  switch (stepId) {
    case '2c':
      if (!fullData.discourse_items) throw new Error('Missing discourse_items for 2c');
      return buildView2c(fullData.discourse_items);

    case '3a':
      if (!fullData.expected_beliefs || !fullData.found_beliefs) {
        throw new Error('Missing beliefs for 3a');
      }
      return buildView3a(fullData.expected_beliefs, fullData.found_beliefs);

    case '4a':
      if (!fullData.current_item || !fullData.current_candidate) {
        throw new Error('Missing item or candidate for 4a');
      }
      return buildView4a(fullData.current_item, fullData.current_candidate.belief);

    case '4b':
      if (!fullData.current_candidate || !fullData.classifications) {
        throw new Error('Missing candidate or classifications for 4b');
      }
      return buildView4b(fullData.current_candidate.belief, fullData.classifications);

    case '4c':
      if (!fullData.current_candidate || !fullData.discourse_items) {
        throw new Error('Missing candidate or discourse_items for 4c');
      }
      return buildView4c(fullData.current_candidate, fullData.discourse_items);

    case '4d':
      if (!fullData.current_candidate || !fullData.bonafide || !fullData.interest || !fullData.classifications) {
        throw new Error('Missing data for 4d');
      }
      return buildView4d(
        fullData.current_candidate,
        fullData.bonafide,
        fullData.interest,
        fullData.classifications
      );

    case '5c':
      if (!fullData.current_candidate || !fullData.invalidators) {
        throw new Error('Missing candidate or invalidators for 5c');
      }
      return buildView5c(fullData.current_candidate.belief, fullData.invalidators);

    default:
      // For other steps, return minimal context
      return {
        topic: fullData.topic,
        audience_context: fullData.audience_context,
        iteration: fullData.iteration,
      };
  }
}
