# STEP 6: ENRICHMENT ROUTING

## PURPOSE

Decide where NSEM (Non-Spine Enrichment Material) goes — or whether it gets cut.

This step routes enrichment material that was classified in Step 1 but held until after graph construction.

---

## INPUT

| Input | Source |
|-------|--------|
| `validation_result` | From Step 5 (must be PASS) |
| `classified_material` | From Step 1 (NSEM-A and NSEM-T items) |
| `graph_with_roles` | From Step 4 (the validated graph) |

---

## OUTPUT

### `nsem_placement_decisions.yaml`

```yaml
nsem_placement_decisions:
  nsem_atomic:
    - item_id: "[NSEM_A_001]"
      decision: TEXTURE | EXCLUDE
      placement: "[UNIT_ID] - brief mention"

  nsem_thematic:
    - item_id: "[NSEM_T_001]"
      decision: INCLUDE | OPTIONAL | EXCLUDE
      placement_zone: "post-resolution epilogue"
      max_runtime: "1-2 minutes"
      primary_risk: "[e.g., boredom, cultural opacity]"

  summary:
    nsem_a_included: [N]
    nsem_a_excluded: [N]
    nsem_t_included: [N]
    nsem_t_optional: [N]
    nsem_t_excluded: [N]
```

---

## PREREQUISITE: SPINE SUFFICIENCY

Before routing any enrichment, confirm:

- **The graph is SUFFICIENT without any NSEM material**
- Validation passed (Step 5)
- Belief collapse/destabilization works with spine alone

If NSEM is required for belief state change:
- **STOP** — this is a Step 1 classification error
- Return to content classification

---

## NSEM-A (ATOMIC) ROUTING

For each NSEM-A item:

### Decision: TEXTURE or EXCLUDE

| Decision | Meaning | Treatment |
|----------|---------|-----------|
| **TEXTURE** | Adds brief color/depth | 1-2 sentences within a unit |
| **EXCLUDE** | Does not add value | Cut entirely |

### Placement Rules for TEXTURE

- Identify which unit the NSEM-A item supports
- Place as brief enrichment INSIDE that unit
- May NOT become its own section/beat
- May NOT interrupt causal flow

```yaml
# Example
- item_id: NSEM_A_003
  decision: TEXTURE
  placement: "UNIT_004 - brief mention when discussing consequences"
```

---

## NSEM-T (THEMATIC) ROUTING

For each NSEM-T item, apply the decision test:

### Decision Test (ALL QUESTIONS REQUIRED)

**Q1 — Spine Independence**
Does the narrative fully work if this item is removed entirely?
- YES → Continue
- NO → STOP — classification error, this is spine material

**Q2 — Meaning Amplification**
Does this item materially deepen how the audience interprets what they've already accepted?
- YES → Possible INCLUDE/OPTIONAL
- NO → Likely EXCLUDE

**Q3 — Audience Segmentation**
Is this primarily valuable to curious/invested viewers, not required for skeptics?
- YES → Appropriate for enrichment
- NO → May be trying to do structural work

**Q4 — Compression Failure**
Would reducing this to 1-2 sentences be misleading or structurally dishonest?
- YES → Needs dedicated treatment (INCLUDE/OPTIONAL)
- NO → Can be reduced to NSEM-A or EXCLUDE

### Decision Assignment

Based on answers, assign EXACTLY ONE:

| Decision | Criteria | Treatment |
|----------|----------|-----------|
| **INCLUDE** | High meaning amplification, passes all tests | Post-resolution epilogue, 1-2 min max |
| **OPTIONAL** | Valuable but not critical | Labeled optional, may be bonus segment |
| **EXCLUDE** | Fails tests or risks distraction | Does not appear |

---

## PLACEMENT ZONES

### Allowed Zones

| Zone | For | Notes |
|------|-----|-------|
| Post-resolution epilogue | NSEM-T (INCLUDE) | After belief state change is complete |
| Optional module | NSEM-T (OPTIONAL) | Explicitly labeled as optional |
| Brief texture within unit | NSEM-A (TEXTURE) | 1-2 sentences only |

### Forbidden Zones

NSEM may NEVER appear:
- During escalation (belief pressure building)
- Between causally dependent units
- As justification for a unit's claims
- Before resolution/destabilization is complete

---

## ANTI-GENERALIZATION RULE

NSEM-T items MUST NOT:
- Generalize into lessons, morals, or prescriptions
- Suggest what audience "should" think or do
- Extrapolate beyond what spine has proven
- Convert implication into advice

If any NSEM-T trends toward generalization:
- Decision MUST be EXCLUDE

---

## PROCESS

### Step 1: Confirm Spine Sufficiency

Verify validation passed and spine works alone.

### Step 2: Route NSEM-A Items

For each NSEM-A:
1. Identify supporting unit (if any)
2. Assign TEXTURE or EXCLUDE
3. Specify placement within unit

### Step 3: Route NSEM-T Items

For each NSEM-T:
1. Answer Q1-Q4
2. Assign INCLUDE, OPTIONAL, or EXCLUDE
3. Specify placement zone and max runtime
4. Note primary risk

### Step 4: Verify No Forbidden Zone Violations

Check that no NSEM is placed in forbidden zones.

### Step 5: Document All Decisions

Compile `nsem_placement_decisions.yaml`.

---

## HARD CONSTRAINTS

- Graph structure MUST remain unchanged
- No NSEM may repair, justify, or complete belief collapse
- NSEM-A may NOT get dedicated sections
- NSEM-T INCLUDE is capped at 1-2 minutes
- All decisions are FINAL after this step

---

## COMPLETION RULE

You are done when:
- Every NSEM item has exactly one decision
- All placements respect forbidden zones
- No enrichment does structural work
- Decisions are documented and final

---

## NEXT STEP

`nsem_placement_decisions` → `steps/gap_identification.md`

Enrichment is routed. Now identify any remaining gaps.
