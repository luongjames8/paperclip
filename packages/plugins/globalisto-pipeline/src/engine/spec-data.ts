/**
 * Vendored canonical thematic pipeline step sequence.
 *
 * Source-of-truth: pipeline-mcp/spec.js → getStepsForContentType("youtube_video_thematic")
 * Module order: discovery → angle_generation → research → structure_thematic →
 *               writing → polish → packaging → music → final_assembly
 *
 * Mapping rules applied:
 *   required_model → requiredModel  (null script steps default to "sonnet")
 *   gates_after    → gatesAfter     (absent → [])
 *   inputs/outputs                  (absent → [])
 *   prompt                          (script-only steps: script path used as prompt fallback)
 */

import type { StepSpec } from "./types.js";

// ── Gate definitions ─────────────────────────────────────────────────────────

/** Full definition of a single gate, extracted from the canonical pipeline-mcp GATES object. */
export interface GateDef {
  type: "local" | "delegated";
  description?: string;
  params?: Record<string, unknown>;
  gateInputMap?: Record<string, unknown>;
}

/**
 * All 24 gate definitions from the canonical pipeline-mcp/spec.js GATES object.
 * gate_input_map keys are camelCased to gateInputMap.
 */
export const GATE_DEFS: Record<string, GateDef> = {
  "research:fetch_count": {
    type: "local",
    description: "Verify minimum evidence fetches per slot",
    params: { min_fetches_per_slot: 3 },
    gateInputMap: {
      slots_fetched: { file: "STEP2_evidence.yaml", key: "slots_fetched" },
    },
  },
  "structure:discard_rate": {
    type: "local",
    description: "Verify minimum material discard rate",
    params: { standard_min: 0.4, comprehensive_min: 0.2 },
    gateInputMap: {
      promotions_made: { file: "STEP2_units.yaml", key: "promotions_made", optional: true },
      original_spine_count: { file: "STEP2_units.yaml", key: "original_spine_count", optional: true },
      effective_spine_count: { file: "STEP2_units.yaml", key: "effective_spine_count", optional: true },
      selected_units: { file: "STEP2_units.yaml", key: "selected_units", optional: true },
      spine_material: { file: "STEP1_classified.yaml", key: "spine_material", optional: true },
    },
  },
  "structure:hook_position": {
    type: "delegated",
    description: "Verify highest hook-strength beat is at position 1",
    gateInputMap: {
      retention_structure: { file: "RETENTION_STRUCTURE.yaml", format: "yaml_dump" },
    },
  },
  "structure:retention_coherence": {
    type: "delegated",
    description: "Verify arc phases, loop events, and chain flows are aligned",
    gateInputMap: {
      retention_structure: { file: "RETENTION_STRUCTURE.yaml", format: "yaml_dump" },
    },
  },
  "structure:pacing_rules": {
    type: "delegated",
    description: "Verify retention pacing constraints are met",
    gateInputMap: {
      retention_structure: { file: "RETENTION_STRUCTURE.yaml", format: "yaml_dump" },
    },
  },
  "structure:credibility_budget": {
    type: "delegated",
    description: "Verify credibility budget stays above minimum",
    gateInputMap: {
      retention_structure: { file: "RETENTION_STRUCTURE.yaml", format: "yaml_dump" },
    },
  },
  "structure:loop_tease_alignment": {
    type: "local",
    description: "Verify teases point to loop closures, not arbitrary future beats",
    gateInputMap: {
      units: { file: "RETENTION_STRUCTURE.yaml", key: "units" },
    },
  },
  "writing:quote_injection": {
    type: "local",
    description: "Verify RESEARCH_MASTER.yaml exists with sufficient sources for writing",
    params: { min_sources: 10 },
    gateInputMap: {
      pipeline_dir: { special: "pipeline_dir" },
    },
  },
  "writing:hook_length": {
    type: "local",
    description: "Verify Section 1 is under 80 words (hook brevity)",
    params: { max_words: 80 },
    gateInputMap: {
      pipeline_dir: { special: "pipeline_dir" },
    },
  },
  "writing:conclusion_behavior": {
    type: "local",
    description: "Detect and block conclusion patterns in final section",
    params: {
      banned_phrases: [
        "in conclusion",
        "to wrap up",
        "as we've seen",
        "as we've learned",
        "what this shows us",
        "the lesson here",
        "this demonstrates that",
        "looking back",
        "throughout this video",
        "we've examined",
        "ultimately",
        "in summary",
        "to sum up",
        "in short",
        "in essence",
        "the takeaway is",
        "taken together",
        "the key insight",
        "to bring everything together",
      ],
    },
    gateInputMap: {
      pipeline_dir: { special: "pipeline_dir" },
    },
  },
  "writing:final_length": {
    type: "local",
    description: "Verify final section length (WARN at 60, BLOCK at 80)",
    params: { warn_threshold: 60, block_threshold: 80 },
    gateInputMap: {
      pipeline_dir: { special: "pipeline_dir" },
    },
  },
  "writing:punchup_integrity": {
    type: "local",
    description: "Verify punch-up preserved structure and citations",
    params: { max_word_delta: 0.15 },
    gateInputMap: {
      pipeline_dir: { special: "pipeline_dir" },
    },
  },
  "angle:title_length": {
    type: "local",
    description: "Verify title is 5-12 words",
    params: { min_words: 5, max_words: 12 },
    gateInputMap: {
      title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" },
    },
  },
  "angle:serp_audit": {
    type: "delegated",
    description: "Check SERP results match target ecosystem via YouTube search",
    gateInputMap: {
      title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" },
      target_ecosystem: { file: "ANGLE_LOCK.yaml", key: "angle_lock.ecosystem" },
    },
  },
  "angle:brand_recognition": {
    type: "delegated",
    description: "Verify title uses T1/T2 recognizable names, not T3 insider terms",
    gateInputMap: {
      title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" },
    },
  },
  "angle:audience_test": {
    type: "delegated",
    description: "Verify title passes audience simulation: mom test, Sony formula, scroll-stop, rage-click, ecosystem routing",
    gateInputMap: {
      title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" },
    },
  },
  "angle:preflight_checklist": {
    type: "delegated",
    description: "5 binary questions about angle viability before proceeding",
    gateInputMap: {
      title: { file: "ANGLE_LOCK.yaml", key: "angle_lock.title" },
      one_sentence_promise: { file: "ANGLE_LOCK.yaml", key: "angle_lock.promise" },
      thumbnail_concept: { file: "ANGLE_LOCK.yaml", key: "angle_lock.thumbnail" },
      opening_hook: { file: "ANGLE_LOCK.yaml", key: "angle_lock.hook" },
      target_ecosystem: { file: "ANGLE_LOCK.yaml", key: "angle_lock.ecosystem" },
    },
  },
  "research:adversarial_coverage": {
    type: "local",
    description: "Verify adversarial track produced genuine counter-evidence",
    params: { min_counter_items: 2 },
    gateInputMap: {
      counter_items: { file: "STEP4_counter.yaml", key: "counter_evidence" },
    },
  },
  "validation:evidence_alignment": {
    type: "delegated",
    description: "Score evidence fit for locked angle, assess pivot need",
    gateInputMap: {
      title: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.title" },
      one_sentence_promise: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.promise" },
      primary_evidence: { file: "RESEARCH_MASTER.yaml", format: "yaml_dump" },
      adversarial_evidence: { file: "STEP4_counter.yaml", format: "yaml_dump" },
      runners_up: { file: "../01b_angle/ANGLE_RUNNERS_UP.yaml", format: "yaml_dump" },
    },
  },
  "writing:title_confirmation": {
    type: "delegated",
    description: "Verify opening confirms title promise within 30 seconds",
    gateInputMap: {
      title: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.title" },
      opening_text: { file: "DRAFT_CONTENT.md", format: "first_section" },
      one_sentence_promise: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.promise" },
    },
  },
  "writing:hook_confirmation_check": {
    type: "delegated",
    description: "Verify hook passes the 5 confirmation criteria",
    gateInputMap: {
      opening_text: { file: "DRAFT_CONTENT.md", format: "first_section" },
      title: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.title" },
      one_sentence_promise: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.promise" },
    },
  },
  "packaging:trinity_gate_check": {
    type: "delegated",
    description: "Verify trinity alignment between title, thumbnail, and hook",
    gateInputMap: {
      title: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.title" },
      thumbnail_concept: { file: "THUMBNAIL_VARIATIONS.yaml", format: "yaml_dump" },
      opening_hook: { file: "../04_writing/DRAFT_CONTENT.md", format: "first_section" },
      trinity_gate_data: { file: "TRINITY_GATE.yaml", format: "yaml_dump" },
    },
  },
  "packaging:ecosystem_consistency": {
    type: "delegated",
    description: "Verify description and tags don't conflict with target ecosystem",
    gateInputMap: {
      target_ecosystem: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.ecosystem" },
      title: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.title" },
      description: { file: "YOUTUBE_DESCRIPTION.md", format: "full_content" },
    },
  },
  "packaging:trinity_alignment": {
    type: "delegated",
    description: "Verify title + thumbnail + opening are complementary, not repetitive",
    gateInputMap: {
      title: { file: "../01b_angle/ANGLE_LOCK.yaml", key: "angle_lock.title" },
      thumbnail_concept: { file: "THUMBNAIL_VARIATIONS.yaml", format: "yaml_dump" },
      opening_hook: { file: "../04_writing/DRAFT_CONTENT.md", format: "first_section" },
      script_opening: { file: "../05_polish/POLISH_COMPLETE.md", format: "first_section" },
    },
  },
};

export const THEMATIC_STEPS: StepSpec[] = [
  // ── discovery (20 steps) ──────────────────────────────────────────────────
  {
    id: "discovery:step_1",
    prompt: "discovery/steps/1_recon.md",
    inputs: [],
    outputs: ["STEP1_recon.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_1_5",
    prompt: "discovery/steps/1.5_belief_decomposition.md",
    inputs: ["STEP1_recon.yaml"],
    outputs: ["STEP1_5_decomposition.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_1_6",
    prompt: "discovery/steps/1.6_hotness_search.md",
    inputs: ["STEP1_5_decomposition.yaml"],
    outputs: ["STEP1_6_hotness.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_1_7",
    prompt: "discovery/steps/1.7_narrative_extraction.md",
    inputs: ["STEP1_6_hotness.yaml"],
    outputs: ["STEP1_7_narrative_cast.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_2a",
    prompt: "discovery/steps/2a_generate_queries.md",
    inputs: ["STEP1_recon.yaml"],
    outputs: ["STEP2a_queries.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_2b",
    prompt: "discovery/steps/2b_extract_items.md",
    inputs: ["STEP2a_queries.yaml"],
    outputs: ["STEP2b_items.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_2c",
    prompt: "discovery/steps/2c_identify_beliefs.md",
    inputs: ["STEP2b_items.yaml"],
    outputs: ["STEP2c_beliefs.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_2d",
    prompt: "discovery/steps/2d_evaluate_novelty.md",
    inputs: ["STEP2c_beliefs.yaml"],
    outputs: ["STEP2d_novelty.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_4a",
    prompt: "discovery/steps/4a_classify_item.md",
    inputs: ["STEP2c_beliefs.yaml", "STEP2b_items.yaml"],
    outputs: ["STEP4a_classification.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_4b",
    prompt: "discovery/steps/4b_score_bonafide.md",
    inputs: ["STEP2c_beliefs.yaml", "STEP4a_classification.yaml"],
    outputs: ["STEP4b_bonafide.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_4c",
    prompt: "discovery/steps/4c_evaluate_interest.md",
    inputs: ["STEP2c_beliefs.yaml", "STEP4b_bonafide.yaml"],
    outputs: ["STEP4c_interest.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_4d",
    prompt: "discovery/steps/4d_make_decision.md",
    inputs: ["STEP4c_interest.yaml"],
    outputs: ["STEP4d_decision.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_5a",
    prompt: "discovery/steps/5a_generate_kill_queries.md",
    inputs: ["STEP4d_decision.yaml"],
    outputs: ["STEP5a_kill_queries.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_5b",
    prompt: "discovery/steps/5b_extract_invalidators.md",
    inputs: ["STEP5a_kill_queries.yaml"],
    outputs: ["STEP5b_invalidators.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_5c",
    prompt: "discovery/steps/5c_evaluate_survival.md",
    inputs: ["STEP5b_invalidators.yaml", "STEP4d_decision.yaml"],
    outputs: ["STEP5c_survival.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_5",
    prompt: "discovery/steps/5_gap_check.md",
    inputs: ["STEP5c_survival.yaml"],
    outputs: ["STEP5_gaps.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "discovery:step_6a",
    prompt: "discovery/steps/6a_determine_content_class.md",
    inputs: ["STEP5_gaps.yaml"],
    outputs: ["STEP6a_content_class.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_6b",
    prompt: "discovery/steps/6b_identify_angles.md",
    inputs: ["STEP6a_content_class.yaml"],
    outputs: ["STEP6b_angles.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_6c",
    prompt: "discovery/steps/6c_generate_slots.md",
    inputs: ["STEP6b_angles.yaml"],
    outputs: ["STEP6c_slots.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "discovery:step_6d",
    prompt: "discovery/steps/6d_export_research.md",
    inputs: ["STEP6c_slots.yaml", "STEP1_7_narrative_cast.yaml"],
    outputs: ["DISCOVERY_COMPLETE.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },

  // ── angle_generation (5 steps) ────────────────────────────────────────────
  {
    id: "angle_generation:step_0",
    prompt: "angle_generation/steps/0_competitor_scan.md",
    inputs: ["../01_discovery/DISCOVERY_COMPLETE.yaml"],
    outputs: ["COMPETITOR_SCAN.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "angle_generation:step_1",
    prompt: "angle_generation/steps/1_agent_proposals.md",
    inputs: ["../01_discovery/DISCOVERY_COMPLETE.yaml", "COMPETITOR_SCAN.yaml"],
    outputs: ["ANGLE_PROPOSAL_A.yaml", "ANGLE_PROPOSAL_B.yaml", "ANGLE_PROPOSAL_C.yaml"],
    requiredModel: "opus",
    gatesAfter: [
      "angle:title_length",
      "angle:serp_audit",
      "angle:brand_recognition",
      "angle:preflight_checklist",
    ],
  },
  {
    id: "angle_generation:step_1c",
    prompt: "angle_generation/steps/1c_title_audience_loop.md",
    inputs: ["ANGLE_PROPOSAL_A.yaml", "ANGLE_PROPOSAL_B.yaml", "ANGLE_PROPOSAL_C.yaml"],
    outputs: ["ANGLE_PROPOSAL_A.yaml", "ANGLE_PROPOSAL_B.yaml", "ANGLE_PROPOSAL_C.yaml"],
    requiredModel: "sonnet",
    gatesAfter: ["angle:audience_test"],
  },
  {
    id: "angle_generation:step_1b",
    prompt: "angle_generation/steps/1b_serp_audit.md",
    inputs: ["ANGLE_PROPOSAL_A.yaml", "ANGLE_PROPOSAL_B.yaml", "ANGLE_PROPOSAL_C.yaml"],
    outputs: ["SERP_AUDIT.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "angle_generation:step_2",
    prompt: "angle_generation/steps/2_human_convergence.md",
    inputs: ["ANGLE_PROPOSAL_A.yaml", "ANGLE_PROPOSAL_B.yaml", "ANGLE_PROPOSAL_C.yaml"],
    outputs: ["ANGLE_LOCK.yaml", "ANGLE_RUNNERS_UP.yaml"],
    requiredModel: "human",
    gatesAfter: [],
  },

  // ── research (6 steps) ────────────────────────────────────────────────────
  {
    id: "research:step_1",
    prompt: "research/steps/slot_analysis.md",
    inputs: ["../01_discovery/DISCOVERY_COMPLETE.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["STEP1_slot_queries.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "research:step_2",
    prompt: "research/steps/evidence_search.md",
    inputs: ["STEP1_slot_queries.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["STEP2_raw_evidence.yaml"],
    requiredModel: "sonnet",
    gatesAfter: ["research:fetch_count"],
  },
  {
    id: "research:step_3",
    prompt: "research/steps/beat_generation.md",
    inputs: ["STEP2_raw_evidence.yaml", "STEP1_slot_queries.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["STEP3_beats.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "research:step_4",
    prompt: "research/steps/counter_evidence.md",
    inputs: ["STEP3_beats.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["STEP4_counter.yaml"],
    requiredModel: "sonnet",
    gatesAfter: ["research:adversarial_coverage"],
  },
  {
    id: "research:step_5",
    prompt: "research/steps/coverage_validation.md",
    inputs: ["STEP3_beats.yaml", "STEP4_counter.yaml", "../01_discovery/DISCOVERY_COMPLETE.yaml"],
    outputs: ["RESEARCH_MASTER.yaml", "POTENTIAL_BEATS.yaml", "COVERAGE_REPORT.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "research:step_6",
    prompt: "research/steps/post_research_validation.md",
    inputs: [
      "../01b_angle/ANGLE_LOCK.yaml",
      "../01b_angle/ANGLE_RUNNERS_UP.yaml",
      "STEP2_raw_evidence.yaml",
      "STEP4_counter.yaml",
      "RESEARCH_MASTER.yaml",
    ],
    outputs: ["ANGLE_VALIDATION.yaml"],
    requiredModel: "sonnet",
    gatesAfter: ["validation:evidence_alignment"],
  },

  // ── structure_thematic (9 steps) ─────────────────────────────────────────
  {
    id: "structure_thematic:step_1",
    prompt: "structure_thematic/steps/1_thematic_synthesis.md",
    inputs: ["../02_research/POTENTIAL_BEATS.yaml", "../01_discovery/DISCOVERY_COMPLETE.yaml"],
    outputs: ["STEP1_themes.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_2",
    prompt: "structure_thematic/steps/2_theme_selection.md",
    inputs: ["STEP1_themes.yaml"],
    outputs: ["STEP2_selected_themes.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_2b",
    prompt: "structure_thematic/steps/2b_audience_proximity.md",
    inputs: ["STEP2_selected_themes.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["STEP2_selected_themes.yaml", "PROXIMITY_REPORT.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_3",
    prompt: "structure_thematic/steps/3_narrative_gap_analysis.md",
    inputs: ["STEP2_selected_themes.yaml"],
    outputs: ["STEP3_narrative_gaps.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_4",
    prompt: "structure_thematic/steps/4_targeted_research.md",
    inputs: ["STEP3_narrative_gaps.yaml"],
    outputs: ["STEP4_narrative_material.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_5",
    prompt: "structure_thematic/steps/5_candidate_adapter.md",
    inputs: ["STEP2_selected_themes.yaml", "STEP4_narrative_material.yaml"],
    outputs: ["candidate_units.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_6",
    prompt: "structure/steps/3_retention_structure.md",
    inputs: ["candidate_units.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["STEP6_retention_structure.yaml"],
    requiredModel: "opus",
    gatesAfter: [
      "structure:hook_position",
      "structure:retention_coherence",
      "structure:pacing_rules",
      "structure:credibility_budget",
      "structure:loop_tease_alignment",
    ],
  },
  {
    id: "structure_thematic:step_7",
    prompt: "structure/steps/4_retention_ordering.md",
    inputs: ["STEP6_retention_structure.yaml"],
    outputs: ["STEP7_ordering.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "structure_thematic:step_8",
    prompt: "structure_thematic/steps/8_thematic_blueprint.md",
    inputs: ["STEP7_ordering.yaml", "STEP6_retention_structure.yaml", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["BEAT_GRAPH.yaml", "BLUEPRINT.md"],
    requiredModel: "opus",
    gatesAfter: [],
  },

  // ── writing (3 steps) ─────────────────────────────────────────────────────
  {
    id: "writing:step_1",
    prompt: "writing/steps/content_execution.md",
    inputs: [
      "../03_structure/BLUEPRINT.md",
      "../03_structure/BEAT_GRAPH.yaml",
      "../01b_angle/ANGLE_LOCK.yaml",
    ],
    outputs: ["DRAFT_CONTENT.md", "WRITING_REPORT.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [
      "writing:hook_length",
      "writing:final_length",
      "writing:conclusion_behavior",
      "writing:title_confirmation",
    ],
  },
  {
    id: "writing:hook_confirmation",
    prompt: "writing/steps/hook_confirmation_gate.md",
    inputs: ["DRAFT_CONTENT.md", "../01b_angle/ANGLE_LOCK.yaml"],
    outputs: ["HOOK_GATE.yaml"],
    requiredModel: "sonnet",
    gatesAfter: ["writing:hook_confirmation_check"],
  },
  {
    id: "writing:step_2",
    prompt: "writing/steps/punch_up.md",
    inputs: ["DRAFT_CONTENT.md"],
    outputs: ["DRAFT_CONTENT_v2.md", "PUNCHUP_LOG.yaml"],
    requiredModel: "opus",
    gatesAfter: ["writing:punchup_integrity"],
  },

  // ── polish (2 steps) ──────────────────────────────────────────────────────
  {
    id: "polish:step_0",
    prompt: "polish/steps/language_level.md",
    inputs: ["../04_writing/DRAFT_CONTENT_v2.md"],
    outputs: ["LEVEL_COMPLETE.md", "LEVEL_REPORT.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "polish:step_1",
    prompt: "polish/steps/language_smooth.md",
    inputs: ["LEVEL_COMPLETE.md"],
    outputs: ["POLISH_COMPLETE.md", "POLISH_REPORT.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },

  // ── packaging (8 steps) ───────────────────────────────────────────────────
  {
    id: "packaging:step_1",
    prompt: "packaging/steps/constrained_title_variations.md",
    inputs: ["../01b_angle/ANGLE_LOCK.yaml", "../05_polish/POLISH_COMPLETE.md"],
    outputs: ["TITLE_VARIATIONS.yaml"],
    requiredModel: "deepseek",
    gatesAfter: [],
  },
  {
    id: "packaging:step_1b",
    prompt: "packaging/steps/cross_niche_thumbnail_scan.md",
    inputs: ["../01b_angle/ANGLE_LOCK.yaml", "../01b_angle/COMPETITOR_SCAN.yaml"],
    outputs: ["CROSS_NICHE_REFERENCE.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "packaging:step_1c",
    prompt: "packaging/steps/thumbnail_generation.md",
    inputs: ["../01b_angle/ANGLE_LOCK.yaml", "CROSS_NICHE_REFERENCE.yaml"],
    outputs: ["THUMBNAIL_CONCEPTS.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "packaging:step_2",
    prompt: "packaging/steps/thumbnail_refinement.md",
    inputs: ["../01b_angle/ANGLE_LOCK.yaml", "../05_polish/POLISH_COMPLETE.md"],
    outputs: ["THUMBNAIL_VARIATIONS.yaml"],
    requiredModel: "opus",
    gatesAfter: ["packaging:trinity_alignment"],
  },
  {
    id: "packaging:step_2b",
    prompt: "packaging/steps/trinity_gate.md",
    inputs: ["../01b_angle/ANGLE_LOCK.yaml", "THUMBNAIL_VARIATIONS.yaml", "TITLE_VARIATIONS.yaml"],
    outputs: ["TRINITY_GATE.yaml"],
    requiredModel: "human",
    gatesAfter: ["packaging:trinity_gate_check"],
  },
  {
    id: "packaging:step_3",
    prompt: "packaging/steps/description_generation.md",
    inputs: [
      "../01b_angle/ANGLE_LOCK.yaml",
      "TITLE_VARIATIONS.yaml",
      "../05_polish/POLISH_COMPLETE.md",
    ],
    outputs: ["YOUTUBE_DESCRIPTION.md"],
    requiredModel: "opus",
    gatesAfter: ["packaging:ecosystem_consistency"],
  },
  {
    id: "packaging:step_4",
    prompt: "packaging/steps/midroll_placement.md",
    inputs: ["../05_polish/POLISH_COMPLETE.md"],
    outputs: ["STEP5_midrolls.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "packaging:step_5",
    prompt: "packaging/steps/shorts_extraction.md",
    inputs: ["../05_polish/POLISH_COMPLETE.md", "../03_structure/BEAT_GRAPH.yaml"],
    outputs: ["STEP6_shorts.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "packaging:step_6",
    prompt: "packaging/steps/production_tags_transform.md",
    inputs: [
      "../05_polish/POLISH_COMPLETE.md",
      "../03_structure/BEAT_GRAPH.yaml",
      "../02_research/RESEARCH_MASTER.yaml",
    ],
    outputs: ["PRODUCTION_SCRIPT.md"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "packaging:step_7",
    prompt: "packaging/steps/editor_resources_assembly.md",
    inputs: [
      "PRODUCTION_SCRIPT.md",
      "STEP5_midrolls.yaml",
      "STEP6_shorts.yaml",
      "../02_research/RESEARCH_MASTER.yaml",
    ],
    outputs: ["EDITOR_RESOURCES.md", "PACKAGING_COMPLETE.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },

  // ── music (5 steps) ───────────────────────────────────────────────────────
  {
    id: "music:step_12a",
    prompt: "music/steps/prompt_12A_genre_lane_abstraction_gate.md",
    inputs: ["../03_structure/BEAT_GRAPH.yaml", "../03_structure/BLUEPRINT.md"],
    outputs: ["GENRE_ASSIGNMENT.yaml"],
    requiredModel: "opus",
    gatesAfter: [],
  },
  {
    id: "music:step_12b",
    prompt: "music/steps/prompt_12B_music_function_collapse.md",
    inputs: ["../03_structure/BEAT_GRAPH.yaml", "../03_structure/BLUEPRINT.md"],
    outputs: ["MUSIC_FUNCTION_MAP.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    // Script-only step (no prompt in spec.js). Using script path as prompt fallback.
    // required_model=null in spec → defaulted to "sonnet".
    id: "music:step_12d",
    prompt: "scripts/calculate_music_durations.js",
    inputs: [
      "../03_structure/BEAT_GRAPH.yaml",
      "MUSIC_FUNCTION_MAP.yaml",
      "../06_packaging/PRODUCTION_SCRIPT.md",
    ],
    outputs: ["MUSIC_DURATIONS.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "music:step_12e",
    prompt: "music/steps/prompt_12E_music_dynamics_mapping.md",
    inputs: [
      "../03_structure/BEAT_GRAPH.yaml",
      "../05_polish/POLISH_COMPLETE.md",
      "../03_structure/ENGAGEMENT_STRATEGY.yaml",
      "MUSIC_DURATIONS.yaml",
    ],
    outputs: ["MUSIC_DYNAMICS.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
  {
    id: "music:step_12c",
    prompt: "music/steps/prompt_12C_suno_style_block_assembler.md",
    inputs: [
      "GENRE_ASSIGNMENT.yaml",
      "MUSIC_FUNCTION_MAP.yaml",
      "MUSIC_DURATIONS.yaml",
      "MUSIC_DYNAMICS.yaml",
    ],
    outputs: ["SUNO_PROMPT_SET.yaml"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },

  // ── final_assembly (1 step) ───────────────────────────────────────────────
  {
    // Script-only step (no prompt in spec.js). Using script path as prompt fallback.
    // required_model=null in spec → defaulted to "sonnet".
    id: "final:master",
    prompt: "scripts/packaging_module.js",
    inputs: ["../05_polish/POLISH_COMPLETE.md", "../06_packaging/PACKAGING_COMPLETE.yaml"],
    outputs: ["MASTER_{topic}.md", "NARRATOR_{topic}.md"],
    requiredModel: "sonnet",
    gatesAfter: [],
  },
];

/**
 * All gate ids from the canonical GATES object in pipeline-mcp/spec.js.
 * Used by validateSpec to catch unknown gate references.
 */
export const KNOWN_GATE_IDS: string[] = Object.keys(GATE_DEFS);
