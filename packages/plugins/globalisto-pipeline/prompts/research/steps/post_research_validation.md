# STEP 6: POST-RESEARCH VALIDATION

## PURPOSE
Evaluate whether collected evidence supports the locked angle strongly enough to proceed, or whether a pivot to a runner-up angle is needed. This step promotes the angle lock from "provisional" to "firm" — or recommends a change.

## INPUT
| Input | Source |
|-------|--------|
| `ANGLE_LOCK.yaml` | Provisional angle lock |
| `ANGLE_RUNNERS_UP.yaml` | Alternative angles preserved from convergence |
| `STEP2_raw_evidence.yaml` | Evidence from primary evidence search track |
| `STEP4_counter.yaml` | Counter-evidence from adversarial track |
| `RESEARCH_MASTER.yaml` | Consolidated research output from coverage validation |

## Pre-Fetched YouTube Results

The following YouTube search results for this topic have been pre-fetched. Analyze them directly — do NOT attempt to call any tools.

{pre_fetched_data}

## PROCESS

### Step 1: Evidence-Angle Fit Score

Read `STEP2_raw_evidence.yaml` and `RESEARCH_MASTER.yaml`. For each major claim in `ANGLE_LOCK.yaml`, evaluate:

- How many independent sources support this claim?
- Are the sources high-credibility (primary documents, filings, named experts) or low-credibility (aggregators, opinion)?
- Does the evidence support the SPECIFIC angle, or just the general topic?

**Score 1-10** with specific justification:

| Score | Meaning |
|-------|---------|
| 9-10 | Evidence overwhelmingly supports angle. Multiple high-credibility sources confirm core claims. |
| 7-8 | Strong support. Most claims well-evidenced, minor gaps fillable. |
| 5-6 | Partial support. Core thesis has evidence but key claims are thin or rely on medium-credibility sources. |
| 3-4 | Weak. Evidence is circumstantial, poorly sourced, or supports the topic but not the specific angle. |
| 1-2 | Contradicted. Evidence actively undermines the angle's core premise. |

### Step 2: Counter-Evidence Assessment

Read `STEP4_counter.yaml`. Evaluate the adversarial track's findings:

- **Fatal counter-evidence:** Does any single finding disprove the core premise? (e.g., angle claims "Brand X is dying" but Brand X just posted record revenue)
- **Manageable counter-evidence:** Findings that add nuance but don't break the angle (e.g., "Brand X's hardware division struggles but services revenue grew" — addressable in the video)
- **Strawman check:** Is the counter-evidence genuinely strong, or did the adversarial track pull punches?

Rate counter-evidence strength 1-10:
- **8-10:** Counter-evidence is devastating. Angle may not survive.
- **5-7:** Meaningful counter-arguments exist. Video must address them or lose credibility.
- **1-4:** Counter-evidence is weak or easily incorporated.

### Step 3: Unique Contribution Check

From the pre-fetched results above, identify the top 3 existing videos on this topic. For each:

1. What angle do they take?
2. What evidence do they use?
3. What do they miss?

Then answer: **Does our video offer something these 3 videos DON'T?**

| Unique Contribution Type | Example |
|--------------------------|---------|
| **New evidence** | Primary source they didn't access (e.g., foreign-language filing, recent earnings data) |
| **Different angle** | They told "rise and fall" — we tell "why the comeback will fail" |
| **Deeper analysis** | They covered surface-level — we have specific numbers, named decisions, causal chains |
| **Timeliness** | Their video is 2+ years old and the situation has materially changed |
| **Counter-narrative** | They all agree on one take — we challenge it with evidence |

If the answer is "no meaningful unique contribution" → this is a KILL signal. There's no reason for anyone to watch our version over Company Man's or ColdFusion's.

### Step 4: Angle Survival Decision

Based on the three assessments above, make ONE of three calls:

#### FIRM
- Evidence fit ≥ 7
- Counter-evidence strength ≤ 6 (manageable)
- Unique contribution is clear and specific
- → Proceed to structure phase

#### PIVOT
- Evidence fit 4-6, OR counter-evidence strength 7+, OR unique contribution unclear
- But a named adjustment could save the angle
- → Trigger a named pivot (see below) and re-validate

**Named Pivot Types:**
| Pivot Type | What Changes | Example |
|------------|-------------|---------|
| **Scope** | Narrow or widen the claim | "How Nike Lost Everything" → "How Nike Lost Gen Z" |
| **Frame** | Same facts, different interpretation | "Nokia's Failure" → "Nokia's Impossible Choice" |
| **Audience** | Retarget to different viewer ecosystem | Business audience → gaming audience |
| **Format** | Change video structure | Chronological → thesis-driven |
| **Topic** | Shift to adjacent topic the evidence actually supports | "Boeing's Decline" → "Boeing vs Airbus: Who's Winning?" |

**If PIVOT:** Name the pivot type, state the adjusted title, and re-run `angle:serp_audit` on the new title before proceeding. The SERP audit must confirm the adjusted title routes to the correct ecosystem (7+ of top 10 results in target genre).

#### KILL
- Evidence fit ≤ 3, OR counter-evidence is fatal (strength 9-10), OR no viable pivot exists
- → Kill this angle. Load runner-up proposals from `ANGLE_RUNNERS_UP.yaml`
- → Re-validate the next best option through this same process
- → If all runner-ups also fail → flag for human intervention (restart)

**If KILL:** Document exactly why the angle died (which evidence contradicted it, or which gap couldn't be filled). This prevents re-proposing the same angle in future runs.

## OUTPUT
### `ANGLE_VALIDATION.yaml`
```yaml
validation:
  angle_title: "[locked angle title]"

  evidence_fit:
    score: 8  # 1-10
    justification: "[Specific: which claims are well-supported, which are thin]"
    strong_evidence:
      - "[Key finding that strongly supports angle]"
      - "[Key finding that strongly supports angle]"
    weak_spots:
      - "[Claim with thin evidence]"

  counter_evidence:
    strength: 4  # 1-10
    fatal_findings: []  # List any that disprove core premise
    manageable_findings:
      - finding: "[Counter-evidence summary]"
        mitigation: "[How the video addresses this]"
    strawman_check: "[Did adversarial track genuinely try to break the angle?]"

  unique_contribution:
    exists: true  # boolean
    type: "[new_evidence | different_angle | deeper_analysis | timeliness | counter_narrative]"
    description: "[What we offer that top 3 existing videos don't]"
    top_3_existing:
      - title: "[Video title]"
        channel: "[Channel]"
        gap: "[What they miss that we cover]"
      - title: "[Video title]"
        channel: "[Channel]"
        gap: "[What they miss that we cover]"
      - title: "[Video title]"
        channel: "[Channel]"
        gap: "[What they miss that we cover]"

  decision: FIRM | PIVOT | KILL
  decision_reasoning: "[2-3 sentences explaining the call]"

  # If PIVOT:
  pivot:
    type: scope | frame | audience | format | topic  # null if not pivoting
    original_title: "[original]"
    adjusted_title: "[new title]"
    serp_audit_passed: true  # Must re-run SERP audit
    what_changed: "[Specific description of the pivot]"

  # If KILL:
  kill:
    reason: "[Why this angle is dead]"
    fatal_evidence: ["[EV_XXX refs]"]
    runner_up_activated: "[Title of next angle to try]"
    prevent_reuse: "[What future proposals should avoid]"
```

After this step, also UPDATE `ANGLE_LOCK.yaml`:
- If FIRM: Change `status: provisional` → `status: firm`
- If PIVOT: Replace angle fields with adjusted values, add `pivot_from: "[original title]"`, `pivot_type: "[named type]"`, status remains `provisional` until re-validated
- If KILL: Replace angle fields with runner-up's values, add `killed_angle: "[original title]"`, `kill_reason: "[reason]"`, status `provisional`

## HARD CONSTRAINTS
- This gate uses the `validation:evidence_alignment` delegated gate
- MUST NOT auto-confirm weak angles — if evidence_fit < 5, it MUST fail
- If counter_evidence strength ≥ 8, decision CANNOT be FIRM without explicit justification for why the counter-evidence is survivable
- Unique contribution check is MANDATORY — "me too" videos are killed
- PIVOT requires naming the pivot type and re-running SERP audit — no unnamed pivots
- KILL requires documenting the failure reason to prevent reuse
- Pivot decisions preserve the pivot history in ANGLE_LOCK.yaml
- Maximum 2 PIVOTs per angle before forcing KILL (prevents infinite pivot loops)

## COMPLETION RULE
Done when: ANGLE_VALIDATION.yaml written AND ANGLE_LOCK.yaml updated to firm (or pivot initiated, or kill executed with runner-up loaded).

## NEXT STEP
- If FIRM: `ANGLE_LOCK.yaml` (firm) → Structure phase
- If PIVOT: Re-run SERP audit → re-enter this validation step
- If KILL: Load runner-up → re-enter this validation step
