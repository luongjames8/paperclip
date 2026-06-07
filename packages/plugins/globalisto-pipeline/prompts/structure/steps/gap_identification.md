# STEP 7: GAP IDENTIFICATION

## PURPOSE

Identify missing research or evidence that would strengthen the structure.

This step finds gaps — it does NOT fill them. Research execution is a separate upstream loop.

---

## INPUT

| Input | Source |
|-------|--------|
| `validation_result` | From Step 5 (may include sufficiency warnings) |
| `graph_with_roles` | From Step 4 (the validated graph) |
| `nsem_placement_decisions` | From Step 6 (enrichment routing) |

---

## OUTPUT

### `research_requests.yaml` (OPTIONAL)

```yaml
research_requests:
  gaps:
    - gap_id: "GAP_001"
      related_unit: "[UNIT_ID]"
      missing_requirement: "[what evidence is needed]"
      why_load_bearing: "[why this matters for the argument]"
      allowed_scope: "fact | statistic | mechanism clarification"
      priority: critical | important | nice_to_have

  summary:
    total_gaps: [N]
    critical: [N]
    important: [N]
    nice_to_have: [N]

  structure_status:
    can_proceed_without_gaps: true | false
    minimum_required: ["GAP_001", "GAP_002"]
```

If no gaps exist, output:

```yaml
research_requests:
  gaps: []
  summary:
    total_gaps: 0
  structure_status:
    can_proceed_without_gaps: true
    minimum_required: []
```

---

## GAP TYPES

### Load-Bearing Gaps (CRITICAL)

Evidence that is REQUIRED for the argument to hold:

- A unit relies on an unstated assumption
- A claim lacks supporting evidence
- A skeptic could reasonably reject a unit

These gaps MUST be filled before proceeding.

### Strengthening Gaps (IMPORTANT)

Evidence that would make the argument stronger:

- Additional supporting data
- Counter-argument preemption
- Mechanism clarification

These gaps SHOULD be filled if possible.

### Polish Gaps (NICE-TO-HAVE)

Evidence that adds depth but isn't structural:

- Additional examples
- Historical context
- Comparative data

These gaps CAN be filled if time permits.

---

## GAP IDENTIFICATION PROCESS

### Step 1: Review Validation Issues

From `validation_result`, extract any:
- Sufficiency test concerns
- Evidence backing warnings
- Skeptic rejection risks

### Step 2: Unit-by-Unit Check

For EACH unit, ask:

| Question | If YES |
|----------|--------|
| Does this unit rely on an unstated assumption? | → GAP (critical) |
| Does this unit depend on evidence we don't have? | → GAP (critical) |
| Would a skeptic reasonably reject this unit? | → GAP (important) |
| Would additional evidence strengthen this? | → GAP (nice-to-have) |
| If this unit fails, does the belief survive? | → Load-bearing assessment |

### Step 3: Classify Each Gap

For each identified gap:

1. **Specify what's missing** — be precise
2. **Explain why it matters** — link to argument
3. **Define allowed scope** — fact, statistic, or mechanism only
4. **Assign priority** — critical, important, or nice-to-have

### Step 4: Assess Proceed-ability

Determine:
- Can structure proceed with gaps unfilled?
- Which gaps are MINIMUM REQUIRED?

---

## ALLOWED RESEARCH SCOPE

Gaps may request ONLY:

| Scope | Meaning |
|-------|---------|
| **fact** | A specific verifiable fact |
| **statistic** | A number or data point |
| **mechanism clarification** | How something works |

Gaps may NOT request:
- New arguments
- New narrative angles
- Interpretation or synthesis
- Opinion or analysis

---

## HARD CONSTRAINTS

- This step IDENTIFIES gaps, it does NOT fill them
- Gaps must map to existing units (no new units from gaps)
- Research scope must be bounded
- Do NOT invent facts to fill gaps
- Do NOT substitute adjacent facts for missing evidence

---

## DECISION LOGIC

```
IF no gaps identified:
  → Structure complete
  → Output empty research_requests
  → Proceed to writing

IF gaps exist BUT all are nice-to-have:
  → Structure can proceed
  → Gaps are optional research

IF gaps exist AND any are critical:
  → Structure BLOCKED
  → Must execute research loop
  → Return to structure after research
```

---

## RESEARCH LOOP (OUT OF SCOPE)

If gaps require research:

1. `research_requests.yaml` goes to research phase
2. Research phase retrieves evidence
3. New evidence returns to structure module
4. Re-run from Step 1 (content classification) with new material

This step outputs the REQUEST. Research execution is separate.

---

## COMPLETION RULE

You are done when:
- All units assessed for gaps
- Each gap has precise specification
- Priority assigned (critical/important/nice-to-have)
- Proceed-ability determined
- research_requests.yaml complete (even if empty)

---

## FINAL OUTPUTS

After this step, the structure module produces three files. Use the following delimiter format:

```
--- FILE: STRUCTURE_GRAPH.yaml ---
(frozen graph with units, order, evidence, NSEM placement)
--- FILE: STRUCTURE_REPORT.yaml ---
(summary of classification, selection, validation)
--- FILE: research_requests.yaml ---
(gap list — may be empty, see schema above)
```

These outputs go to:
- Writing module (if ready)
- Research phase (if gaps need filling)
