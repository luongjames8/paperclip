/**
 * Discovery Module Enforcement - Type Definitions
 *
 * Core interfaces for the deterministic enforcement layer.
 * LLM executes steps; Node enforces gates.
 */

// =============================================================================
// PIPELINE STATE
// =============================================================================

export type PipelineState =
  | 'INIT'
  | 'PHASE_1'
  | 'PHASE_2'
  | 'PHASE_3'
  | 'PHASE_4'
  | 'PHASE_5'
  | 'PHASE_6'
  | 'SUCCESS'
  | 'FAILED_NO_BELIEFS'
  | 'FAILED_INSUFFICIENT'
  | 'BLOCKED';

export type DiscoveryMode = 'topic_first' | 'belief_first';

// =============================================================================
// CONTEXT PACK (passed to each step)
// =============================================================================

export interface ContextPack {
  topic: string;
  mode: DiscoveryMode;
  iteration: number;
  phase: number;
  step_id: string;
  audience_context?: string;
  time_window_months: number;

  // Active state
  active_candidates: CandidateBelief[];
  discourse_items_summary: DiscourseItemSummary[];

  // Enforcement results
  gate_results: GateResult[];
  verifier_results: VerifierResult[];
}

// =============================================================================
// DISCOURSE ITEMS
// =============================================================================

export interface DiscourseItem {
  id: string;
  content: string;
  source: string;
  source_type: 'reddit' | 'forum' | 'article' | 'blog' | 'youtube' | 'wiki' | 'other';
  url: string;
  date?: string;
  is_hot: boolean;
}

export interface DiscourseItemSummary {
  id: string;
  source_type: string;
  is_hot: boolean;
  has_sincere_belief: boolean;
}

export type ItemClassification = 'SINCERE' | 'STRAWMAN' | 'NEUTRAL';

export interface ClassifiedItem {
  item_id: string;
  classification: ItemClassification;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
}

// =============================================================================
// BELIEFS
// =============================================================================

export interface ExpectedBelief {
  id: string;
  belief: string;
  aspect: string;
  predicted_by: 'top_down';
}

export interface FoundBelief {
  id: string;
  belief: string;
  supporting_items: string[];
  found_by: 'bottom_up';
}

export type SourcePath = 'top_down_only' | 'bottom_up_only' | 'intersection';
export type NoveltyRating = 'PREDICTABLE' | 'INTERESTING';

export interface CandidateBelief {
  id: string;
  belief: string;
  source_path: SourcePath;
  novelty: NoveltyRating;
  supporting_items: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

// =============================================================================
// VALIDATION SCORES
// =============================================================================

export type ScoreLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface BonafideScore {
  level: ScoreLevel;
  sincere_count: number;
  strawman_count: number;
  neutral_count: number;
  source_count: number;
  reasons: string[];
}

export interface InterestScore {
  level: ScoreLevel;
  recency: 'HOT' | 'WARM' | 'STALE';
  surprise_value: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: string[];
}

export type ValidationDecision = 'GO' | 'NO-GO' | 'PRIORITY';

export interface ValidationResult {
  belief_id: string;
  bonafide: BonafideScore;
  interest: InterestScore;
  decision: ValidationDecision;
  priority_rank: number;
  reasons: string[];
}

// =============================================================================
// INVALIDATION
// =============================================================================

export interface Invalidator {
  id: string;
  claim: string;
  source_url: string;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  type: 'factual_error' | 'outdated' | 'misattribution' | 'nuance_missing' | 'counterexample';
}

export type SurvivalVerdict = 'SURVIVES' | 'WOUNDED' | 'KILLED';

export interface SurvivalResult {
  belief_id: string;
  original_belief: string;
  verdict: SurvivalVerdict;
  refined_belief?: string;
  invalidators: Invalidator[];
  strong_invalidator_count: number;
  reasons: string[];
}

// =============================================================================
// OUTPUT SLOTS
// =============================================================================

export type ContentClass = 'detonator' | 'mirror';

export interface Angle {
  id: string;
  description: string;
  priority: number;
}

export interface Slot {
  slot_id: string;
  description: string;
  required: boolean;
  angle_id?: string;
}

export interface DiscoveryResult {
  belief: string;
  content_class: ContentClass;
  provisional_outline: Slot[];
}

// =============================================================================
// GATES
// =============================================================================

export type GateId =
  | 'sufficiency'
  | 'novelty'
  | 'bonafide'
  | 'interesting_veto'
  | 'survival'
  | 'refinement_sharpness'
  | 'shape'
  | 'all_killed';

export interface GateResult {
  gate: GateId;
  pass: boolean;
  reasons: string[];
  override?: GateOverride;
  action?: GateAction;
}

export interface GateOverride {
  field: string;
  original_value: unknown;
  new_value: unknown;
}

export type GateAction =
  | { type: 'CONTINUE' }
  | { type: 'LOOP'; target: string; max_iterations?: number }
  | { type: 'STOP'; reason: string }
  | { type: 'OVERRIDE'; field: string; value: unknown }
  | { type: 'BLOCK'; reason: string };

// =============================================================================
// VERIFIER
// =============================================================================

export type CheckpointId =
  | 'after_2b'
  | 'after_4d'
  | 'after_5c'
  | 'before_6a';

// =============================================================================
// SPECIFICITY-SURPRISE JUDGE
// =============================================================================

export type CollapseFlag =
  | 'NUMERIC_DROPPED'
  | 'POPULATION_COMPARISON_DROPPED'
  | 'MECHANISM_REMOVED'
  | 'PARADOX_REMOVED'
  | 'BLAMEFRAME_SUBSTITUTION'
  | 'VAGUE_ABSTRACTION'
  | 'HEDGE_INJECTION'
  | 'SCOPE_BROADENED'
  | 'UNFALSIFIABLE';

export interface JudgeOutput {
  pass: boolean;
  specificity_delta: -2 | -1 | 0 | 1 | 2;
  surprise_delta: -2 | -1 | 0 | 1 | 2;
  collapse_flags: CollapseFlag[];
  rationale: string;
  required_fix?: string;
}

export interface JudgeRequest {
  needs_judge: true;
  judge_prompt: string;
  input: {
    original_belief: string;
    refined_belief: string;
    wound_summary?: string;
    invalidator_summary?: string;
  };
}

export interface VerifierResult {
  checkpoint: CheckpointId;
  passed: boolean;
  reasons: string[];
  override?: GateOverride;
  terminal?: boolean;
  judge_request?: JudgeRequest;
  judge_output?: JudgeOutput;
}

// =============================================================================
// ARTIFACT STORE
// =============================================================================

export interface Artifact {
  artifact_id: string;
  step_id: string;
  timestamp: string;
  hash: string;
  frozen: boolean;
  payload: unknown;
}

export interface ArtifactBundle {
  artifacts: Map<string, Artifact>;
  hash_chain: string[];
}

// =============================================================================
// PIPELINE INPUT/OUTPUT
// =============================================================================

export interface DiscoveryInput {
  topic?: string;
  candidate_belief?: string;
  mode: DiscoveryMode;
  time_window_months?: number;
  audience_context?: string;
  config?: DiscoveryConfig;
}

export interface DiscoveryConfig {
  min_sincere_items: number;
  min_sources: number;
  max_candidates: number;
  hot_threshold_months: number;
  concurrency: {
    max_parallel_searches: number;
    max_parallel_fetches: number;
    max_parallel_candidates: number;
    max_parallel_items: number;
  };
}

export interface DiscoveryOutput {
  status: 'SUCCESS' | 'FAILED';
  result?: DiscoveryResult;
  debug: DiscoveryDebug;
  error?: string;
}

// =============================================================================
// DEBUG OUTPUT
// =============================================================================

export interface DiscoveryDebug {
  mode: DiscoveryMode;
  input_topic?: string;
  input_belief?: string;

  phase_1_top_down?: {
    aspects: string[];
    expected_beliefs: ExpectedBelief[];
  };

  phase_2_bottom_up?: {
    iterations: Phase2Iteration[];
    final_found_beliefs: FoundBelief[];
  };

  phase_3_fusion?: {
    matches: BeliefMatch[];
    candidates: CandidateBelief[];
  };

  phase_4_validation: ValidationResult[];

  phase_5_invalidation: SurvivalResult[];

  phase_6_slots?: {
    content_class: ContentClass;
    angles: Angle[];
    provisional_outline: Slot[];
  };

  final_belief?: string;
  selection_reason?: string;

  artifacts: ArtifactReference[];
  gate_log: GateResult[];
  verifier_log: VerifierResult[];
}

export interface Phase2Iteration {
  iteration: number;
  queries: string[];
  items_found: number;
  beliefs_found: FoundBelief[];
  novelty_evaluation: {
    has_interesting: boolean;
    recommendation: 'CONTINUE' | 'STOP';
  };
}

export interface BeliefMatch {
  expected_id?: string;
  found_id?: string;
  match_type: 'exact' | 'partial' | 'unmatched';
}

export interface ArtifactReference {
  artifact_id: string;
  step_id: string;
  hash: string;
}

// =============================================================================
// STEP OUTPUTS (structured data from each step)
// =============================================================================

export interface Step1aOutput {
  aspects: string[];
}

export interface Step1bOutput {
  expected_beliefs: ExpectedBelief[];
}

export interface Step2aOutput {
  queries: string[];
}

export interface Step2bOutput {
  status: 'SUFFICIENT' | 'INSUFFICIENT';
  discourse_items?: DiscourseItem[];
  gaps?: string[];
  recommendation?: string;
}

export interface Step2cOutput {
  found_beliefs: FoundBelief[];
}

export interface Step2dOutput {
  has_interesting: boolean;
  novelty_ratings: Array<{ belief_id: string; novelty: NoveltyRating }>;
  recommendation: 'CONTINUE' | 'STOP';
  refinement_hints?: string[];
}

export interface Step3aOutput {
  matches: BeliefMatch[];
  unmatched_top_down: string[];
  unmatched_bottom_up: string[];
}

export interface Step3bOutput {
  candidates: CandidateBelief[];
}

export interface Step4aOutput {
  classifications: ClassifiedItem[];
}

export interface Step4bOutput {
  bonafide: BonafideScore;
}

export interface Step4cOutput {
  interest: InterestScore;
}

export interface Step4dOutput {
  decision: ValidationDecision;
  priority_rank: number;
  reasons: string[];
}

export interface Step5aOutput {
  kill_queries: string[];
}

export interface Step5bOutput {
  invalidators: Invalidator[];
}

export interface Step5cOutput {
  verdict: SurvivalVerdict;
  refined_belief?: string;
  reasons: string[];
}

export interface Step6aOutput {
  content_class: ContentClass;
  reasons: string[];
}

export interface Step6bOutput {
  angles: Angle[];
}

export interface Step6cOutput {
  provisional_outline: Slot[];
}

// =============================================================================
// V2 VERIFICATION TYPES
// =============================================================================

/**
 * Verification status for a quote.
 * VERIFIED = URL fetched, quote found on page (2 points)
 * SUPPORTED = URL unfetchable, quote found in WebSearch snippet (1 point)
 * UNVERIFIED = Cannot confirm quote exists (0 points)
 */
export type VerificationStatus = 'VERIFIED' | 'SUPPORTED' | 'UNVERIFIED';

/**
 * Result of verifying a single quote.
 */
export interface QuoteVerification {
  url: string;
  claimed_quote: string;
  status: VerificationStatus;
  matched_text?: string;
  context?: string;
  match_score?: number;
  failure_reason?: 'fetch_failed' | 'quote_not_found' | 'timeout' | 'js_required';
}

/**
 * Result of verifying all quotes for a belief.
 */
export interface BeliefVerification {
  belief: string;
  quotes: QuoteVerification[];
  total_points: number;
  unique_domains: number;
  verified_count: number;
  supported_count: number;
  unverified_count: number;
  accepted: boolean;
  rejection_reason?: string;
}

/**
 * Supporting quote with URL - required for v2 verification.
 */
export interface SupportingQuote {
  url: string;
  quote: string; // 10-500 chars, exact text
  discourse_item_id: string; // Reference to D_xx
}

/**
 * Fetched content for verification.
 */
export interface FetchedContent {
  url: string;
  content: string | null; // null if fetch failed
  fetch_status: 'fetched' | 'unfetchable' | 'js_required' | 'timeout';
  snippet?: string; // WebSearch snippet fallback
}

// =============================================================================
// V2 THEME (from recon phase)
// =============================================================================

/**
 * Theme discovered during recon phase.
 */
export interface Theme {
  id: string; // T_01, T_02, etc.
  name: string; // Short label (3-8 words)
  description: string; // What this theme covers (1-2 sentences)
  source_platforms: string[]; // Which platforms surfaced this
  heat_score?: number; // 0-100, relative activity level
  sample_quotes?: string[]; // 2-3 representative excerpts
  search_queries_used?: string[]; // Which queries found this
}

/**
 * Platform heat map from recon.
 */
export interface PlatformHeat {
  platform: string;
  heat_score: number; // 0-100
  sample_count: number;
}

// =============================================================================
// V2 DISCOURSE ITEM (extended)
// =============================================================================

/**
 * Extended discourse item for v2 with required URL and fetch tracking.
 */
export interface DiscourseItemV2 {
  id: string; // D_01, D_02, etc.
  url: string; // REQUIRED - must be actual source URL
  excerpt: string; // 50-500 chars, verbatim from source
  source_type: 'reddit' | 'article' | 'forum' | 'youtube' | 'twitter' | 'news' | 'wiki' | 'other';
  platform: string; // r/japanlife, Japan Times, etc.
  date?: string; // ISO 8601 or YYYY-MM approximate
  author?: string; // Username or "Anonymous"
  engagement?: {
    upvotes?: number;
    comments?: number;
    shares?: number;
  };
  // Internal tracking
  fetch_status: 'fetched' | 'unfetchable' | 'js_required' | 'pending';
  raw_content?: string; // Full page content if fetched (for verification)
  fetch_timestamp?: string; // When content was retrieved
}

// =============================================================================
// V2 CANDIDATE BELIEF (with verification support)
// =============================================================================

/**
 * Belief status state machine for v2.
 */
export type BeliefStatus =
  | 'PENDING' // Initial state after extraction
  | 'VERIFYING' // Phase 4 verification in progress
  | 'VERIFIED' // Passed Phase 4 (≥3 points, ≥1 VERIFIED quote, ≥2 domains)
  | 'REJECTED' // Failed Phase 4 verification
  | 'FLAGGED' // Passed Phase 4 but has context warnings
  | 'NEEDS_REVIEW' // Conflicting evidence, requires human input
  | 'VALIDATING' // Phase 6 kill query testing in progress
  | 'VALIDATED' // Passed Phase 6 (survived or refined)
  | 'KILLED'; // Failed Phase 6 (too many invalidators)

/**
 * Status history entry for audit trail.
 */
export interface StatusHistoryEntry {
  status: BeliefStatus;
  reason: string;
  timestamp: string;
}

/**
 * Extended candidate belief for v2 with verification support.
 */
export interface CandidateBeliefV2 {
  id: string; // B_01, B_02, etc.
  belief: string; // The belief statement (20-200 chars)
  supporting_quotes: SupportingQuote[]; // Minimum 2 required
  category?: string; // Theme/angle this relates to
  strength?: 'strong' | 'moderate' | 'weak'; // Pre-verification
  // Verification output (added by deterministic verification)
  verification?: {
    status: 'accepted' | 'rejected' | 'insufficient';
    total_points: number;
    unique_domains: number;
    quotes: QuoteVerification[];
  };
  // Status tracking
  status: BeliefStatus;
  status_reason?: string; // Why this status was assigned
  status_timestamp?: string; // When status changed
  status_history?: StatusHistoryEntry[]; // Full audit trail
  review_notes?: string; // Human notes if NEEDS_REVIEW was resolved manually
  // Conflict resolution
  validation_note?: string; // Notes from conflict resolution
  opposing_quotes?: QuoteVerification[]; // Counter-evidence found
}

// =============================================================================
// V2 STEP OUTPUTS
// =============================================================================

/**
 * Output from 1_recon step (replaces 1a + 1b).
 */
export interface Step1ReconOutput {
  themes: Theme[]; // 5-15 themes
  platform_heat_map: PlatformHeat[];
  search_log: Array<{
    query: string;
    results_count: number;
    platform: string;
  }>;
}

/**
 * Updated 2a output for v2 - queries based on themes.
 */
export interface Step2aOutputV2 {
  queries: Array<{
    query: string;
    target_platform: string;
    theme_id: string;
  }>;
}

/**
 * Updated 2b output for v2 - with fetch tracking.
 */
export interface Step2bOutputV2 {
  status: 'SUFFICIENT' | 'INSUFFICIENT';
  discourse_items: DiscourseItemV2[];
  fetch_log: Array<{
    url: string;
    status: 'fetched' | 'unfetchable' | 'js_required' | 'timeout';
    duration_ms: number;
    error?: string;
  }>;
  gaps?: string[];
  recommendation?: string;
}

/**
 * Updated 2c output for v2 - beliefs with supporting quotes.
 */
export interface Step2cOutputV2 {
  found_beliefs: CandidateBeliefV2[];
}

/**
 * Gap check step output (new in v2).
 */
export interface StepGapCheckOutput {
  gaps: Array<{
    description: string;
    suggested_queries: string[];
  }>;
  decision: 'iterate' | 'sufficient';
  coverage_stats: {
    themes_with_beliefs: number;
    total_themes: number;
    high_heat_platforms_with_beliefs: number;
  };
}

// =============================================================================
// V2 DISCOVERY RESULT (final output)
// =============================================================================

/**
 * Extended discovery result for v2.
 */
export interface DiscoveryResultV2 {
  meta: {
    topic: string;
    audience_context?: string;
    pipeline_version: '2.0';
    run_timestamp: string;
    total_searches: number;
    total_fetches: number;
  };
  belief: {
    text: string;
    content_class: ContentClass;
    verification: {
      status: 'accepted';
      total_points: number;
      verified_quotes: Array<{
        url: string;
        quote: string;
        match_score: number;
      }>;
    };
  };
  provisional_outline: Array<{
    slot_id: string;
    description: string;
    required: boolean;
    angle: string;
    source_type?: 'statistic' | 'expert_quote' | 'case_study' | 'comparison';
  }>;
  audit_trail: {
    themes_discovered: number;
    beliefs_extracted: number;
    beliefs_rejected: number;
    verification_success_rate: number;
  };
}

// =============================================================================
// V2 GATE TYPES
// =============================================================================

/**
 * Extended gate IDs for v2.
 */
export type GateIdV2 =
  | GateId
  | 'belief_verification' // After 2c - deterministic verification
  | 'survival_verification'; // After 5c - verify invalidators are real

/**
 * Verification gate result.
 */
export interface VerificationGateResult {
  pass: boolean;
  verified_beliefs: BeliefVerification[];
  rejected_beliefs: BeliefVerification[];
  summary: {
    total_beliefs: number;
    accepted_count: number;
    rejected_count: number;
    total_quotes_checked: number;
    verification_rate: number;
  };
}
