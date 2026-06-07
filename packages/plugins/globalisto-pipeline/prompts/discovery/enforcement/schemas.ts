/**
 * Discovery Module Enforcement - Zod Validation Schemas
 *
 * Runtime validation for all structured data in the discovery pipeline.
 * These schemas enforce the contracts that LLM outputs must meet.
 */

import { z } from 'zod';

// =============================================================================
// ENUMS
// =============================================================================

export const PipelineStateSchema = z.enum([
  'INIT',
  'PHASE_1',
  'PHASE_2',
  'PHASE_3',
  'PHASE_4',
  'PHASE_5',
  'PHASE_6',
  'SUCCESS',
  'FAILED_NO_BELIEFS',
  'FAILED_INSUFFICIENT',
  'BLOCKED',
]);

export const DiscoveryModeSchema = z.enum(['topic_first', 'belief_first']);

export const SourceTypeSchema = z.enum([
  'reddit',
  'forum',
  'article',
  'blog',
  'youtube',
  'wiki',
  'other',
]);

export const ItemClassificationSchema = z.enum(['SINCERE', 'STRAWMAN', 'NEUTRAL']);

export const SourcePathSchema = z.enum(['top_down_only', 'bottom_up_only', 'intersection']);

export const NoveltyRatingSchema = z.enum(['PREDICTABLE', 'INTERESTING']);

export const ScoreLevelSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const RecencySchema = z.enum(['HOT', 'WARM', 'STALE']);

export const ValidationDecisionSchema = z.enum(['GO', 'NO-GO', 'PRIORITY']);

export const InvalidatorStrengthSchema = z.enum(['STRONG', 'MODERATE', 'WEAK']);

export const InvalidatorTypeSchema = z.enum([
  'factual_error',
  'outdated',
  'misattribution',
  'nuance_missing',
  'counterexample',
]);

export const SurvivalVerdictSchema = z.enum(['SURVIVES', 'WOUNDED', 'KILLED']);

export const ContentClassSchema = z.enum(['detonator', 'mirror']);

export const GateIdSchema = z.enum([
  'sufficiency',
  'novelty',
  'bonafide',
  'interesting_veto',
  'survival',
  'refinement_sharpness',
  'shape',
  'all_killed',
]);

export const CheckpointIdSchema = z.enum([
  'after_2b',
  'after_4d',
  'after_5c',
  'before_6a',
]);

export const ConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

// =============================================================================
// DISCOURSE ITEMS
// =============================================================================

export const DiscourseItemSchema = z.object({
  id: z.string().regex(/^D_\d{2,3}$/),
  content: z.string().min(10),
  source: z.string().min(1),
  source_type: SourceTypeSchema,
  url: z.string().url(),
  date: z.string().optional(),
  is_hot: z.boolean(),
});

export const DiscourseItemSummarySchema = z.object({
  id: z.string(),
  source_type: z.string(),
  is_hot: z.boolean(),
  has_sincere_belief: z.boolean(),
});

export const ClassifiedItemSchema = z.object({
  item_id: z.string(),
  classification: ItemClassificationSchema,
  confidence: ConfidenceSchema,
  reasoning: z.string(),
});

// =============================================================================
// BELIEFS
// =============================================================================

export const ExpectedBeliefSchema = z.object({
  id: z.string().regex(/^EB_\d{2}$/),
  belief: z.string().min(10),
  aspect: z.string(),
  predicted_by: z.literal('top_down'),
});

export const FoundBeliefSchema = z.object({
  id: z.string().regex(/^FB_\d{2}$/),
  belief: z.string().min(10),
  supporting_items: z.array(z.string()).min(1),
  found_by: z.literal('bottom_up'),
});

export const CandidateBeliefSchema = z.object({
  id: z.string().regex(/^CB_\d{2}$/),
  belief: z.string().min(10),
  source_path: SourcePathSchema,
  novelty: NoveltyRatingSchema,
  supporting_items: z.array(z.string()),
  confidence: ConfidenceSchema,
});

// =============================================================================
// VALIDATION
// =============================================================================

export const BonafideScoreSchema = z.object({
  level: ScoreLevelSchema,
  sincere_count: z.number().int().nonnegative(),
  strawman_count: z.number().int().nonnegative(),
  neutral_count: z.number().int().nonnegative(),
  source_count: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});

export const InterestScoreSchema = z.object({
  level: ScoreLevelSchema,
  recency: RecencySchema,
  surprise_value: ScoreLevelSchema,
  reasons: z.array(z.string()),
});

export const ValidationResultSchema = z.object({
  belief_id: z.string(),
  bonafide: BonafideScoreSchema,
  interest: InterestScoreSchema,
  decision: ValidationDecisionSchema,
  priority_rank: z.number().int().min(1).max(5),
  reasons: z.array(z.string()),
});

// =============================================================================
// INVALIDATION
// =============================================================================

export const InvalidatorSchema = z.object({
  id: z.string().regex(/^INV_\d{2}$/),
  claim: z.string().min(10),
  source_url: z.string().url(),
  strength: InvalidatorStrengthSchema,
  type: InvalidatorTypeSchema,
});

export const SurvivalResultSchema = z.object({
  belief_id: z.string(),
  original_belief: z.string(),
  verdict: SurvivalVerdictSchema,
  refined_belief: z.string().optional(),
  invalidators: z.array(InvalidatorSchema),
  strong_invalidator_count: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});

// =============================================================================
// SLOTS
// =============================================================================

export const AngleSchema = z.object({
  id: z.string().regex(/^ANG_\d{2}$/),
  description: z.string().min(5),
  priority: z.number().int().min(1).max(10),
});

export const SlotSchema = z.object({
  slot_id: z.string().regex(/^AP_\d{2}$/),
  description: z.string().min(10),
  required: z.boolean(),
  angle_id: z.string().optional(),
});

export const DiscoveryResultSchema = z.object({
  belief: z.string().min(10),
  content_class: ContentClassSchema,
  provisional_outline: z.array(SlotSchema).min(4).max(8),
});

// =============================================================================
// GATES
// =============================================================================

export const GateOverrideSchema = z.object({
  field: z.string(),
  original_value: z.unknown(),
  new_value: z.unknown(),
});

export const GateActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CONTINUE') }),
  z.object({
    type: z.literal('LOOP'),
    target: z.string(),
    max_iterations: z.number().optional(),
  }),
  z.object({ type: z.literal('STOP'), reason: z.string() }),
  z.object({ type: z.literal('OVERRIDE'), field: z.string(), value: z.unknown() }),
  z.object({ type: z.literal('BLOCK'), reason: z.string() }),
]);

export const GateResultSchema = z.object({
  gate: GateIdSchema,
  pass: z.boolean(),
  reasons: z.array(z.string()),
  override: GateOverrideSchema.optional(),
  action: GateActionSchema.optional(),
});

// =============================================================================
// SPECIFICITY-SURPRISE JUDGE
// =============================================================================

export const CollapseFlagSchema = z.enum([
  'NUMERIC_DROPPED',
  'POPULATION_COMPARISON_DROPPED',
  'MECHANISM_REMOVED',
  'PARADOX_REMOVED',
  'BLAMEFRAME_SUBSTITUTION',
  'VAGUE_ABSTRACTION',
  'HEDGE_INJECTION',
  'SCOPE_BROADENED',
  'UNFALSIFIABLE',
]);

export const JudgeInputSchema = z.object({
  original_belief: z.string().min(10),
  refined_belief: z.string().min(10),
  wound_summary: z.string().optional(),
  invalidator_summary: z.string().optional(),
});

export const JudgeOutputSchema = z.object({
  pass: z.boolean(),
  specificity_delta: z.number().int().min(-2).max(2),
  surprise_delta: z.number().int().min(-2).max(2),
  collapse_flags: z.array(CollapseFlagSchema),
  rationale: z.string().max(500),
  required_fix: z.string().optional(),
});

export const JudgeRequestSchema = z.object({
  needs_judge: z.literal(true),
  judge_prompt: z.string(),
  input: JudgeInputSchema,
});

// =============================================================================
// VERIFIER
// =============================================================================

export const VerifierResultSchema = z.object({
  checkpoint: CheckpointIdSchema,
  passed: z.boolean(),
  reasons: z.array(z.string()),
  override: GateOverrideSchema.optional(),
  terminal: z.boolean().optional(),
  judge_request: JudgeRequestSchema.optional(),
  judge_output: JudgeOutputSchema.optional(),
});

// =============================================================================
// STEP OUTPUTS
// =============================================================================

export const Step1aOutputSchema = z.object({
  aspects: z.array(z.string()).min(3).max(7),
});

export const Step1bOutputSchema = z.object({
  expected_beliefs: z.array(ExpectedBeliefSchema).min(3).max(10),
});

export const Step2aOutputSchema = z.object({
  queries: z.array(z.string()).min(5).max(10),
});

export const Step2bOutputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('SUFFICIENT'),
    discourse_items: z.array(DiscourseItemSchema).min(25), // Up from 10 - feeds belief funnel
  }),
  z.object({
    status: z.literal('INSUFFICIENT'),
    discourse_items: z.array(DiscourseItemSchema).optional(),
    gaps: z.array(z.string()),
    recommendation: z.string(),
  }),
]);

export const Step2cOutputSchema = z.object({
  found_beliefs: z.array(FoundBeliefSchema).min(1),
});

export const Step2dOutputSchema = z.object({
  has_interesting: z.boolean(),
  novelty_ratings: z.array(
    z.object({
      belief_id: z.string(),
      novelty: NoveltyRatingSchema,
    })
  ),
  recommendation: z.enum(['CONTINUE', 'STOP']),
  refinement_hints: z.array(z.string()).optional(),
});

export const Step3aOutputSchema = z.object({
  matches: z.array(
    z.object({
      expected_id: z.string().optional(),
      found_id: z.string().optional(),
      match_type: z.enum(['exact', 'partial', 'unmatched']),
    })
  ),
  unmatched_top_down: z.array(z.string()),
  unmatched_bottom_up: z.array(z.string()),
});

export const Step3bOutputSchema = z.object({
  candidates: z.array(CandidateBeliefSchema).min(1),
});

export const Step4aOutputSchema = z.object({
  classifications: z.array(ClassifiedItemSchema),
});

export const Step4bOutputSchema = z.object({
  bonafide: BonafideScoreSchema,
});

export const Step4cOutputSchema = z.object({
  interest: InterestScoreSchema,
});

export const Step4dOutputSchema = z.object({
  decision: ValidationDecisionSchema,
  priority_rank: z.number().int().min(1).max(5),
  reasons: z.array(z.string()),
});

export const Step5aOutputSchema = z.object({
  kill_queries: z.array(z.string()).min(3).max(7),
});

export const Step5bOutputSchema = z.object({
  invalidators: z.array(InvalidatorSchema),
});

export const Step5cOutputSchema = z.object({
  verdict: SurvivalVerdictSchema,
  refined_belief: z.string().optional(),
  reasons: z.array(z.string()),
});

export const Step6aOutputSchema = z.object({
  content_class: ContentClassSchema,
  reasons: z.array(z.string()),
});

export const Step6bOutputSchema = z.object({
  angles: z.array(AngleSchema).min(2).max(5),
});

export const Step6cOutputSchema = z.object({
  provisional_outline: z.array(SlotSchema).min(4).max(8),
});

// =============================================================================
// PIPELINE INPUT
// =============================================================================

export const DiscoveryConfigSchema = z.object({
  min_sincere_items: z.number().int().positive().default(3),
  min_sources: z.number().int().positive().default(2),
  max_candidates: z.number().int().positive().default(10),
  hot_threshold_months: z.number().int().positive().default(6),
  concurrency: z.object({
    max_parallel_searches: z.number().int().positive().default(3),
    max_parallel_fetches: z.number().int().positive().default(2),
    max_parallel_candidates: z.number().int().positive().default(2),
    max_parallel_items: z.number().int().positive().default(3),
  }),
});

export const DiscoveryInputSchema = z
  .object({
    topic: z.string().min(3).optional(),
    candidate_belief: z.string().min(10).optional(),
    mode: DiscoveryModeSchema,
    time_window_months: z.number().int().positive().default(12),
    audience_context: z.string().optional(),
    config: DiscoveryConfigSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.mode === 'topic_first' && !data.topic) {
        return false;
      }
      if (data.mode === 'belief_first' && !data.candidate_belief) {
        return false;
      }
      return true;
    },
    {
      message:
        'topic_first mode requires topic; belief_first mode requires candidate_belief',
    }
  );

// =============================================================================
// SUFFICIENCY GATE INPUT
// =============================================================================

export const SufficiencyInputSchema = z.object({
  discourse_items: z.array(DiscourseItemSchema),
  min_items: z.number().int().positive().default(25),        // Up from 15
  min_reddit_forum: z.number().int().nonnegative().default(8), // Up from 5
  min_fetched: z.number().int().nonnegative().default(5),     // Up from 3
  min_source_types: z.number().int().positive().default(4),   // Up from 3
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Validate and parse LLM output for a specific step
 */
export function validateStepOutput<T>(
  stepId: string,
  output: unknown,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(output);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map(
      (e) => `${stepId}: ${String(e.path.join('.'))}: ${e.message}`
    ),
  };
}

/**
 * Schema registry for step validation
 */
export const StepSchemas: Record<string, z.ZodType<unknown>> = {
  '1a': Step1aOutputSchema,
  '1b': Step1bOutputSchema,
  '2a': Step2aOutputSchema,
  '2b': Step2bOutputSchema,
  '2c': Step2cOutputSchema,
  '2d': Step2dOutputSchema,
  '3a': Step3aOutputSchema,
  '3b': Step3bOutputSchema,
  '4a': Step4aOutputSchema,
  '4b': Step4bOutputSchema,
  '4c': Step4cOutputSchema,
  '4d': Step4dOutputSchema,
  '5a': Step5aOutputSchema,
  '5b': Step5bOutputSchema,
  '5c': Step5cOutputSchema,
  '6a': Step6aOutputSchema,
  '6b': Step6bOutputSchema,
  '6c': Step6cOutputSchema,
};
