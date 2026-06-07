# STEP 4: EVIDENCE ASSIGNMENT

## PURPOSE

Assign evidence roles to prevent fact duplication and ensure each claim is established exactly once.

This step answers: "Where does each fact get its full treatment, and where is it merely referenced?"

---

## INPUT

| Input | Source |
|-------|--------|
| `ordered_graph` | From Step 3 (ordered units with SS attached) |
| `classified_material` | From Step 1 (for evidence details) |
| `medium` | Determines role enforcement strictness |

---

## OUTPUT

### `graph_with_roles.yaml`

```yaml
graph_with_roles:
  units:
    - unit_id: "[UNIT_001]"
      evidence_refs:
        - id: "[DATA_POINT_ID]"
          role: PRIMARY
          claim: "[what this establishes]"
        - id: "[DATA_POINT_ID]"
          role: SUPPORTING
          claim: "[detail it adds]"

    - unit_id: "[UNIT_002]"
      evidence_refs:
        - id: "[DATA_POINT_ID]"
          role: REFERENCE
          primary_location: "UNIT_001"
          treatment: "one-sentence acknowledgment"

  evidence_summary:
    primary_claims: [N]
    supporting_uses: [N]
    reference_uses: [N]
    data_points_used: ["[ID]", "[ID]", ...]
```

---

## SECTION 1 CONSTRAINT (BEAT_01)

BEAT_01 has strict evidence limitations:
- **PRIMARY evidence ONLY** - no SUPPORTING
- REFERENCE role forbidden (can't reference facts not yet established)

Rationale: Section 1 is the hook window. Supporting detail creates cognitive
load before the main question is planted. Keep it tight.

---

## EVIDENCE ROLES

| Role | Meaning | Treatment | Limit |
|------|---------|-----------|-------|
| **PRIMARY** | This unit establishes this fact | Full explanation, context, establishment | ONE unit per fact |
| **SUPPORTING** | Adds detail to the unit's primary claim | Enhances but doesn't duplicate | Unlimited |
| **REFERENCE** | Fact established elsewhere | One sentence max + link/callback | Unlimited |

---

## THE ONE-PRIMARY RULE

**Each data point can be PRIMARY for exactly ONE unit.**

If a fact appears in multiple units:
1. ONE unit gets PRIMARY (full treatment)
2. All other units get REFERENCE (brief acknowledgment)

This prevents:
- Repetitive explanations
- Audience fatigue from re-hearing the same fact
- Bloated content

---

## MEDIUM-SPECIFIC BEHAVIOR

### Web (`web_page`)

Strict enforcement:
- PRIMARY claims must be tracked site-wide
- REFERENCE must link to primary location
- Check if fact already has PRIMARY elsewhere before assigning

```yaml
# Web: explicit linking
evidence_refs:
  - id: dp_subto_001
    role: REFERENCE
    primary_location: "page_T.3"
    treatment: "See [Subject-To Mechanics] for details"
```

### Video (`video`)

Implicit enforcement:
- PRIMARY = where fact is first explained
- REFERENCE = callbacks to earlier explanation
- No cross-linking needed (linear medium)

```yaml
# Video: implicit
evidence_refs:
  - id: dp_star_001
    role: REFERENCE
    primary_location: "BEAT_003"
    treatment: "As we saw earlier..."
```

### Article (`article`)

Moderate enforcement:
- PRIMARY = full treatment section
- REFERENCE = brief mention with internal navigation hint

---

## PROCESS

### Step 1: List All Evidence

For each unit, list all data points it uses:
- From the unit's derived_from materials
- From attached structural support

### Step 2: Identify Shared Evidence

Find data points that appear in multiple units.

### Step 3: Assign PRIMARY

For each shared data point:
1. Determine which unit NEEDS to establish it (causal logic)
2. Assign PRIMARY to that unit
3. The unit that explains WHY the fact matters usually gets PRIMARY

**BEAT_01 Exception:**
```
IF beat_id == "BEAT_01":
  - ALL evidence assigned to BEAT_01 must be PRIMARY
  - No SUPPORTING role allowed
  - Flag any attempt to add supporting evidence as error
```

### Step 4: Assign REFERENCE

For all other uses of the same data point:
- Assign REFERENCE role
- Note the primary location
- Specify treatment (one-sentence callback)

### Step 5: Assign SUPPORTING

For evidence that:
- Only appears in one unit AND
- Adds detail to a PRIMARY claim

Assign SUPPORTING role.

### Step 6: Verify Coverage

Check that:
- Every data point has exactly ONE PRIMARY
- All non-PRIMARY uses are marked REFERENCE or SUPPORTING
- No fact gets full treatment twice

---

## CLAIM TRACKING

For each PRIMARY assignment, document the claim:

```yaml
claims_established:
  - id: dp_subto_001
    claim: "Subject-to keeps the loan in seller's name"
    established_in: "UNIT_003"
```

This becomes the reference for downstream phases.

---

## HARD CONSTRAINTS

- Every fact has exactly ONE PRIMARY assignment
- REFERENCE treatment is ONE SENTENCE MAX
- Do NOT re-explain facts — reference them
- Web content MUST track primary locations for linking

---

## COMPLETION RULE

You are done when:
- All evidence has roles assigned
- Each data point has exactly one PRIMARY
- Shared evidence properly distributed (PRIMARY + REFERENCE)
- Claim list documented
- Treatment specified for each REFERENCE

---

## NEXT STEP

`graph_with_roles` → `steps/graph_validation.md`

Graph with evidence roles proceeds to validation.
