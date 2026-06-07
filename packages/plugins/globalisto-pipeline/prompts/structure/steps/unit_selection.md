# STEP 2: UNIT SELECTION

## PURPOSE

Select the minimum set of units required to achieve belief state change.

This step answers: "Which spine material becomes a structural unit?"

---

## INPUT

| Input | Source |
|-------|--------|
| `classified_material` | From Step 1 (SM and SS items only) |
| `content_class` | `detonator` or `mirror` |
| `medium` | Determines unit type (beat vs module) |
| `selection_mode` | `standard` (default) or `comprehensive` |

---

## OUTPUT

### `candidate_units.yaml`

```yaml
candidate_units:
  selection_mode: standard | comprehensive

  # Promotions (if spine was insufficient)
  promotions:
    - item_id: "[ID]"
      original_role: SS | NSEM-T
      promoted_to: SM
      rationale: "[why this can carry a beat]"

  units:
    - unit_id: "[UNIT_001]"
      derived_from: ["[SM_ID]", "[SM_ID]"]
      description: "[what this unit conveys]"
      pressure_applied: "[specific pressure on belief]"
      evidence_confidence: high | medium
      promoted: false | true  # true if derived from promoted material

  selection_summary:
    original_spine_count: [N]  # Before promotions
    promotions_made: [N]
    effective_spine_count: [N]  # After promotions
    units_selected: [N]
    minimum_required: [N]  # For this medium
    minimum_met: true | false

  discarded:
    - item_id: "[SM_ID]"
      reason: "[why discarded]"
```

---

## UNIT TERMINOLOGY BY MEDIUM

| Medium | Unit Type | Notes |
|--------|-----------|-------|
| `video` | beat | Linear narrative, emotional arc |
| `web_page` | module | Cross-page, retrievable |
| `article` | section | Linear with navigation |

The term "unit" is used generically. Output uses medium-appropriate terminology.

---

## SELECTION CRITERIA (ALL MUST PASS)

### 1. Applies Distinct Pressure

The unit must apply pressure that NO OTHER UNIT applies.

Test: "If I remove this unit, is the pressure it applies still covered?"
- YES → redundant, discard
- NO → distinct, keep

**Comprehensive mode adjustment:** In comprehensive mode, two units may apply similar pressure if they use *different evidence* or *different emotional register*. The test becomes: "If I remove this unit, is the pressure applied *in this way* still covered?"

### 2. Well-Evidenced

| Confidence | Include? |
|------------|----------|
| HIGH | Yes |
| MEDIUM | Yes, with caution |
| LOW | No — discard |

Do NOT include low-confidence material as structural units.

### 3. Necessary for Belief State Change

Test: "Does the belief collapse/destabilization fail without this?"
- YES → necessary, keep
- NO → optional, likely discard

### 4. Not Redundant with Another Unit

If two potential units make the same argument with different evidence:
- Keep the stronger one
- Discard the weaker one
- Do NOT keep both

---

## CONTENT CLASS RULES

### DETONATOR

Select the minimum set that **fully collapses** the belief.
- Every unit must advance toward collapse
- Final unit must complete the collapse
- No ambiguity may remain

### MIRROR

Select the minimum set that **destabilizes without resolving** the belief.
- Every unit must apply pressure
- Final unit must leave tension open
- At least one causal uncertainty must remain unresolved

---

## TARGET COUNTS

| Medium | Page/Content Type | Minimum | Target | Maximum |
|--------|-------------------|---------|--------|---------|
| video | standard | **6** | 8-10 | 12 |
| video | short | 3 | 4-5 | 6 |
| web_page | structure | 6 | 8-12 | 15 |
| web_page | situation | 5 | 6-8 | 10 |
| web_page | reference | 5 | 6-10 | 12 |
| web_page | action | 4 | 5-8 | 10 |
| article | standard | 4 | 5-8 | 10 |

**CRITICAL: Minimum counts are MANDATORY for video content.**

For video, failing to meet minimum beat count produces a video too short to sustain viewer engagement. If spine material alone cannot meet minimum, you MUST promote material (see Spine Sufficiency Check below).

---

## DISCARD RATE

Discard rate is calculated from **effective spine** (original SM + promotions).

### When promotions were made:
- Discard rate expectations are relaxed
- Priority is meeting minimum beat count
- Some "redundancy" is acceptable to reach minimum
- Focus on narrative quality, not strict discard percentages

### When spine was sufficient (no promotions needed):

#### IF selection_mode == standard (default)

| Discard Rate | Assessment |
|--------------|------------|
| < 40% | Review for redundancy unless material is rich |
| 40-70% | Healthy range |
| > 80% | Under-selected — verify belief can still collapse |

#### IF selection_mode == comprehensive

| Discard Rate | Assessment |
|--------------|------------|
| < 20% | Acceptable for comprehensive mode |
| 20-50% | Healthy range |
| > 60% | Under-selected — may be losing valuable context |

**Comprehensive mode rationale:** Some content strategies (long-form video, complex mirror-class narratives) benefit from retaining more material to build emotional resonance.

---

## SPINE SUFFICIENCY CHECK (MANDATORY)

**Before selecting from spine, verify you have enough material.**

### Check: Does SM count meet minimum for medium?

| Medium | Minimum SM Needed |
|--------|-------------------|
| video (standard) | 6 |
| video (short) | 3 |
| web_page | 5 |
| article | 4 |

### IF SM count < minimum: PROMOTE MATERIAL

When spine material is insufficient, you MUST promote items from SS (Structural Support) or NSEM-T (Thematic Enrichment) to reach minimum.

**Promotion Priority Order:**
1. **SS items** that could stand alone (not just clarification of another item)
2. **NSEM-T items** marked "could sustain 60+ seconds" in classification
3. **SS clusters** - multiple SS items that combine into a coherent beat

**Promotion Test:**
For each candidate:
- Does this material carry narrative weight? (not just explanation)
- Could this sustain viewer attention as a standalone beat?
- Does this add distinct pressure or context to the arc?

If YES to all three → PROMOTE to spine.

**Document promotions:**
```yaml
promotions:
  - item_id: "[ID]"
    original_role: SS | NSEM-T
    promoted_to: SM
    rationale: "[why this can carry a beat]"
```

### Example: McKinsey/Opioid

If spine has only 5 items but minimum is 6:
- Look at SS items like "CVS would have received $36.8M" (PB_02)
- This isn't just explanation - it's a SCALE revelation
- PROMOTE: It can carry a beat showing the financial magnitude

### NEVER Promote:
- NSEM-A items (too thin)
- CF items (cut material)
- Low-confidence evidence
- Material that only makes sense attached to spine

---

## PROCESS

### Step 1: List All Spine Material

From `classified_material`, extract all SM (Spine Material) items.

### Step 1b: Run Spine Sufficiency Check

If SM count < minimum for medium:
1. Review SS and NSEM-T items
2. Identify promotion candidates
3. Apply promotion test
4. Document promotions
5. Add promoted items to SM list

### Step 2: Group by Pressure Type

Cluster SM items by the type of pressure they apply:
- Which items make the same argument?
- Which items target the same assumption?

### Step 3: Select One Per Pressure Type

For each cluster:
- Pick the strongest (best evidenced, clearest)
- Discard the rest as redundant

### Step 4: Verify Minimum Set

Check: "With only these units, does belief collapse/destabilize?"
- YES → selection complete
- NO → identify missing pressure, add unit

### Step 5: Verify No Redundancy

Check: "Can I remove any unit without losing pressure?"
- YES → remove it
- NO → keep it

### Step 6: Document Discards

For each discarded SM item:
```yaml
- item_id: "[SM_ID]"
  reason: redundant | weak_evidence | not_necessary | covered_by: "[UNIT_ID]"
```

---

## HARD CONSTRAINTS

- Select from Spine Material (SM) + any promoted items
- **For video: MUST meet minimum beat count (6 for standard, 3 for short)**
- Each unit must apply DISTINCT pressure
- LOW confidence material may NOT become units
- Redundant arguments → keep ONE, discard rest
- The set must be SUFFICIENT to achieve belief state change
- If SM < minimum: MUST run promotion check before selection

---

## STRUCTURAL SUPPORT HANDLING

SS (Structural Support) items are NOT selected as units.

They are carried forward and attached to units in the ordering step — they live INSIDE units, not as standalone units.

---

## COMPLETION RULE

You are done when:
- **Spine sufficiency check completed** (promotions made if needed)
- All SM items (including promoted) evaluated
- **Unit count meets minimum for medium** (6 for video standard)
- Units apply distinct pressure (per selection_mode criteria)
- Evidence confidence is HIGH or MEDIUM for all
- Discard rate is reasonable (but may be lower if promotions were needed)
- The set achieves belief state change
- Discards and promotions documented with reasons

---

## NEXT STEP

`candidate_units` → `steps/unit_ordering.md`

Units proceed to ordering by causal dependency.
