# STRUCTURE MODULE

## MODEL SELECTION

| Step | Model | Rationale |
|------|-------|-----------|
| 1. Classification | Opus | Nuance in categorization |
| 2. Selection | Opus (DeepSeek OK) | Only safe delegation point |
| 3A. Ordering | Opus | Causal reasoning |
| 3B. Engagement | Opus | Psychological modeling, adversarial review |
| 4. Evidence Assignment | Opus | Role accuracy |
| 5. Validation | Opus | False-positive risk |
| 6. Enrichment Routing | Opus | Placement judgment |
| 7. Gap Identification | Opus | Severity assessment |
| 8. Blueprint Compilation | DeepSeek | Mechanical transformation |

See `MODEL_SELECTION.md` for test results and detailed rationale.

---

## PURPOSE

Build a validated graph of structural units (beats, modules) from raw material and belief.

This module handles: classify material → select units → order by causality → assign evidence → validate → route enrichment → identify gaps.

**This module performs NO writing.** Output is a frozen graph for downstream writing.

---

## INPUTS

| Input | Required | Purpose |
|-------|----------|---------|
| `potential_material` | Yes | Raw research, facts, quotes from upstream |
| `belief` | Yes | The belief to collapse or destabilize |
| `content_class` | Yes | `detonator` \| `mirror` |
| `medium` | Yes | `video` \| `web_page` \| `article` |
| `selection_mode` | No | `standard` (default) \| `comprehensive` - controls discard aggressiveness |
| `domain` | No | Domain lens for tone guardrails (e.g., `legal`, `financial`, `general`) |
| `page_type` | No | Web-specific: `situation` \| `structure` \| `hub` |

---

## OUTPUTS

### `STRUCTURE_GRAPH.yaml`

Frozen graph of units with:
- Unit IDs, types, and emotional functions
- Causal ordering
- Evidence assignments (PRIMARY/REFERENCE)
- NSEM placement decisions

### `ENGAGEMENT_STRATEGY.yaml`

Viewer retention strategy with:
- Engine selection (open_loops, emotional_arc, value_density, identity_tribe)
- Hook zone analysis (strength: HIGH/MEDIUM/LOW)
- Forward pull design (loops, arcs, density maps, or tribe signals)
- Tease points and pattern interrupts
- End behavior strategy
- Validation verdict (PASS/REVIEW/OVERRIDE_REQUIRED)

### `BEAT_GRAPH.yaml`

Copy of STRUCTURE_GRAPH.yaml in the format expected by Writing module.
(Produced by Step 8 - Blueprint Compilation)

### `NARRATIVE_BLUEPRINT.md`

Human-readable markdown combining structure and engagement strategy.
Used by Writing and Packaging modules for section-based analysis.
(Produced by Step 8 - Blueprint Compilation)

### `STRUCTURE_REPORT.yaml`

```yaml
STRUCTURE_REPORT:
  units_selected: [count]
  units_discarded: [count]
  material_classification:
    spine: [count]
    structural_support: [count]
    nsem_atomic: [count]
    nsem_thematic: [count]
    contextual_flavor_cut: [count]
  engagement_strategy:
    engine: [primary engine]
    hook_strength: [HIGH/MEDIUM/LOW]
    verdict: [PASS/REVIEW]
  validation:
    passed: true
    issues: []
  gaps_identified: []
  ready_for_writing: true
```

---

## PARAMETERS

### medium

| Value | Unit Type | Notes |
|-------|-----------|-------|
| `video` | beats | Linear narrative, emotional arc critical |
| `web_page` | modules | Cross-page linking, PRIMARY/REFERENCE roles |
| `article` | sections | Linear but may have internal navigation |

### content_class

| Value | Final State Rule |
|-------|------------------|
| `detonator` | Belief fully collapses - resolution required |
| `mirror` | Belief destabilizes but doesn't resolve - tension remains |

### selection_mode

Controls how aggressively material is discarded during unit selection.

| Value | Discard Rate | Use Case |
|-------|--------------|----------|
| `standard` | 50-70% | Default. Tight, focused content. Each unit must apply distinct pressure. |
| `comprehensive` | 30-50% | Retains more material for emotional journey. Better for complex narratives. |

**When to use `comprehensive`:**
- Long-form video content prioritizing emotional arc over brevity
- Mirror-class content where multiple mechanisms need exploration
- Content where the audience benefits from fuller context

**Consumer defaults:**
- clearframe, surplus-kb → `standard`
- globalisto, Hinomaru → `comprehensive`

### domain (tone guardrails)

| Value | Guardrail Lens |
|-------|----------------|
| `legal` | No fear language, DIY-first positioning |
| `financial` | No fear language, no guarantees |
| `general` | Not too negative, not preachy |
| `commercial` | Not too salesy |

---

## EXECUTION

This module runs in 9 steps (Step 3 has two parts: 3A ordering, 3B engagement):

### Step 1: Content Classification
**Prompt:** `steps/content_classification.md`

Classify all material as SPINE, STRUCTURAL SUPPORT, NSEM, or CONTEXTUAL FLAVOR.
- INPUT: `potential_material`, `belief`
- OUTPUT: `classified_material`

### Step 2: Unit Selection
**Prompt:** `steps/unit_selection.md`

Select units that apply distinct pressure toward belief state change. Discard rate depends on `selection_mode`.
- INPUT: `classified_material`, `content_class`, `selection_mode`
- OUTPUT: `candidate_units`

---

#### Gate: Discard Rate Validation

**AFTER unit_selection:** Ensure minimum material discard rate.

```bash
npx tsx prompts/enforcement/cli.ts structure:discard_rate @candidate_units.yaml --output-dir .
```

**Input:** `candidate_units.yaml` with selection statistics:

```json
{
  "selection_mode": "standard",
  "spine_material_available": 20,
  "units_selected": 10
}
```

**Thresholds (configurable in config.yaml):**
- Standard mode: discard rate >= 40%
- Comprehensive mode: discard rate >= 20%

**Actions:**
- `CONTINUE`: Discard rate meets minimum - proceed to unit_ordering
- `BLOCK`: Under-discarded - re-run unit_selection with more aggressive filtering

**Recovery on BLOCK:**
1. Review `reasons` array for specific discard rate shortfall
2. Re-evaluate classified_material with stricter "distinct pressure" criteria
3. Identify redundant or weak-pressure units for removal
4. Re-run unit_selection
5. Re-run gate to confirm

**Why this matters:** Under-selection creates unfocused content. Every unit must apply distinct pressure toward belief state change.

---

### Step 3A: Unit Ordering
**Prompt:** `steps/unit_ordering.md`

Order units by causal dependency. REFRAME/resolution beats last.
- INPUT: `candidate_units`
- OUTPUT: `ordered_graph`

### Step 3B: Engagement Strategy
**Router:** `steps/3b3_forward_pull_router.md`
**Config:** `engagement_config.schema.yaml`

Design viewer retention strategy based on content class. Runs as sub-pipeline:

| Sub-step | Prompt | Purpose |
|----------|--------|---------|
| 3B-0 | `steps/3b0_input_validation.md` | Validate inputs, init pipeline context |
| 3B-1 | `steps/3b1_engine_selection.md` | Select engagement engine from content_class |
| 3B-2 | `steps/3b2_hook_zone_audit.md` | Audit beats 1-2 for stakes + curiosity |
| 3B-3 | `steps/3b3_forward_pull_router.md` | Route to engine + adversarial review |
| 3B-3a | `steps/3b3a_engine_open_loops.md` | (if open_loops engine) |
| 3B-3b | `steps/3b3b_engine_emotional_arc.md` | (if emotional_arc engine) |
| 3B-3c | `steps/3b3c_engine_value_density.md` | (if value_density engine) |
| 3B-3d | `steps/3b3d_engine_identity_tribe.md` | (if identity_tribe engine) |
| 3B-3e | `steps/3b3e_adversarial_review.md` | Stress-test engagement strategy |
| 3B-4 | `steps/3b4_enhancements.md` | Add teases, interrupts, end behavior |
| 3B-5 | `steps/3b5_assembly.md` | Assemble ENGAGEMENT_STRATEGY.yaml |

- INPUT: `ordered_graph`, `content_class`
- OUTPUT: `ENGAGEMENT_STRATEGY.yaml`
- HALT CONDITIONS: Adversarial review may halt for revision; Assembly may require override

### Step 4: Evidence Assignment
**Prompt:** `steps/evidence_assignment.md`

Assign PRIMARY/REFERENCE roles for fact deduplication.
- INPUT: `ordered_graph`, `classified_material`, `ENGAGEMENT_STRATEGY.yaml`
- OUTPUT: `graph_with_roles`

### Step 5: Graph Validation
**Prompt:** `steps/graph_validation.md`

Validate structure against requirements derived from inputs.
- INPUT: `graph_with_roles`, `content_class`, `medium`, `domain`, `ENGAGEMENT_STRATEGY.yaml`
- OUTPUT: `validation_result` (pass/issues)

### Step 6: Enrichment Routing
**Prompt:** `steps/enrichment_routing.md`

Decide where NSEM material goes (which unit, post-resolution, or cut).
- INPUT: `graph_with_roles`, `classified_material` (NSEM items)
- OUTPUT: `nsem_placement_decisions`

### Step 7: Gap Identification
**Prompt:** `steps/gap_identification.md`

Identify missing research or evidence gaps.
- INPUT: `validation_result`, `graph_with_roles`
- OUTPUT: `research_requests` (optional, may be empty)

### Step 8: Blueprint Compilation
**Prompt:** `steps/8_blueprint_compilation.md`

Compile final Structure outputs into formats expected by downstream modules.
- INPUT: `STRUCTURE_GRAPH.yaml`, `ENGAGEMENT_STRATEGY.yaml`
- OUTPUT: `BEAT_GRAPH.yaml`, `NARRATIVE_BLUEPRINT.md`

This is a mechanical transformation step - no judgment required.

---

## HARD CONSTRAINTS (NON-NEGOTIABLE)

This module may NOT:
- Write prose or draft content
- Add facts not in `potential_material`
- Skip content classification step
- Approve a graph that fails validation

This module MUST:
- Classify ALL material before selection
- Order by causal dependency, not preference
- Assign each fact PRIMARY to exactly ONE unit
- Validate against content_class final state rules
- Flag gaps rather than filling them with invented content

---

## PRINCIPLES

1. **Distinct pressure** - each unit must apply pressure the others don't
2. **Causal dependency** - order by "must understand X before Y", not preference
3. **Spine vs enrichment** - know the difference, cut what weakens
4. **One PRIMARY** - each fact lives in one place, referenced elsewhere
5. **Validate against inputs** - checks derive from content_class, medium, domain
6. **Gaps are data** - missing research is output, not failure

---

## INTEGRATION

### Upstream Dependencies
- Research phase: `potential_material` (facts, quotes, sources)
- Belief definition: `belief` statement

### Downstream
- Writing module: consumes `BEAT_GRAPH.yaml`, `NARRATIVE_BLUEPRINT.md`
- Packaging module: consumes `NARRATIVE_BLUEPRINT.md`
- Gap research may loop back to research phase

---

*Steps will be designed by reading equivalent phases from globalisto, clearframe, surplus-kb, investment-tube.*
