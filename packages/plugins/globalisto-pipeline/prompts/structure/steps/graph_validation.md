# STEP 5: GRAPH VALIDATION

## PURPOSE

Validate that the graph is structurally sound, properly evidenced, and sufficient to achieve belief state change.

This step is DIAGNOSTIC ONLY — it flags issues, it does NOT fix them.

---

## INPUT

| Input | Source |
|-------|--------|
| `graph_with_roles` | From Step 4 (ordered units with evidence roles) |
| `content_class` | `detonator` or `mirror` |
| `medium` | Determines which checks apply |
| `domain` | Determines tone guardrail lens |

---

## OUTPUT

### `validation_result.yaml`

```yaml
validation_result:
  status: PASS | FAIL
  blocking_issues: []
  warnings: []

  checks:
    structural_integrity: PASS | FAIL
    evidence_sufficiency: PASS | FAIL
    belief_progression: PASS | FAIL
    coverage_balance: PASS | FAIL
    sufficiency_test: PASS | FAIL

  required_fixes:
    - issue: "[description]"
      return_to: "step_[N]"
```

---

## VALIDATION CHECKS

### CHECK 1: Structural Integrity

Verify that the graph is well-formed:

| Check | Question | FAIL If |
|-------|----------|---------|
| Traceability | Does each unit trace to source material? | Any unit has no `derived_from` |
| Dependencies | Are all dependencies logical (not preference)? | Any dependency fails the "argument breaks" test |
| No cycles | Is the dependency graph acyclic? | Circular dependencies exist |

---

### CHECK 2: Evidence Sufficiency

For EACH unit:

| Check | Question | FAIL If |
|-------|----------|---------|
| Evidence exists | Does the unit have evidence refs? | Any unit has no evidence |
| Evidence valid | Do refs point to existing data? | Orphan evidence (can't be traced) |
| Confidence | Is evidence HIGH or MEDIUM confidence? | LOW confidence evidence in structural unit |
| Claim support | Does evidence actually support the claim? | Claims exceed evidence |

---

### CHECK 3: PRIMARY Evidence Rule

For each PRIMARY evidence assignment:

| Check | Question | FAIL If |
|-------|----------|---------|
| Uniqueness | Is this the only PRIMARY for this fact? | Same fact has PRIMARY in multiple units |
| Web: site-wide | Is this fact already PRIMARY elsewhere? | Conflict with existing claims (web only) |

---

### CHECK 4: Belief State Progression

Verify belief states progress logically:

```
UNIT_001: belief_intact → belief_questioned
UNIT_002: belief_questioned → belief_pressured
...
UNIT_N: belief_pressured → belief_transformed (detonator)
        OR → belief_destabilized (mirror)
```

| Check | Question | FAIL If |
|-------|----------|---------|
| Progression | Does each unit advance belief state? | Regression without justification |
| No gaps | Are state transitions logical? | Jumps that skip intermediate states |
| Final state | Does final state match content_class? | Detonator without collapse, mirror with resolution |

---

### CHECK 5: Coverage Balance

If units cover multiple articulation points (web):

| Check | Question | WARNING If |
|-------|----------|------------|
| All APs covered | Does every AP have at least one unit? | Any AP has zero coverage |
| Balanced | Is coverage ratio ≤ 3:1? | One AP dominates (without justification) |

---

### CHECK 6: Sufficiency Test

Ask: **"Could a skeptical audience reject the belief state change after absorbing all units?"**

| Answer | Result |
|--------|--------|
| NO — argument is airtight | PASS |
| YES — there's a gap | FAIL — identify the weakness |
| MAYBE — edge case | WARNING — note the risk |

### Skeptic Test Questions

- Does any unit rely on an unstated assumption?
- Does any unit depend on evidence we don't have?
- Is there a plausible counter-argument we haven't addressed?
- If any unit fails, does the belief survive?

---

## MEDIUM-SPECIFIC CHECKS

### Video (`video`)

| Check | Question | FAIL If |
|-------|----------|---------|
| Format alignment | Does structure match selected narrative format? | Sections violate format constraints |
| Retention integrity | Do open loops close where promised? | Dropped or artificial loops |
| Weight distribution | Are WEIGHT beats properly distributed? | Front-loaded or no landing space |

### Web (`web_page`)

| Check | Question | FAIL If |
|-------|----------|---------|
| Routing (situation pages) | Do situation pages route to structures? | No routing modules |
| Module tagging | Are retrieval tags complete? | Missing tags, situations, structures |
| Standalone assessment | Is `standalone_capable` set for each? | Incomplete standalone metadata |

### Article (`article`)

| Check | Question | FAIL If |
|-------|----------|---------|
| Section flow | Do sections flow logically? | Abrupt transitions |
| Navigation hints | Can reader find their way? | No internal navigation structure |

---

## DOMAIN-SPECIFIC CHECKS

### Tone Guardrails

Based on `domain` parameter:

| Domain | Check For |
|--------|-----------|
| `legal` | No fear language, no guarantees, DIY-first positioning |
| `financial` | No fear language, no promises of outcomes |
| `general` | Not too negative, not preachy, not non-PC |
| `commercial` | Not too salesy |

---

## PROCESS

### Step 1: Run Structural Checks

Execute checks 1-3. Document any failures.

### Step 2: Run Progression Check

Execute check 4. Verify belief states.

### Step 3: Run Coverage Check

Execute check 5 (if applicable).

### Step 4: Run Sufficiency Test

Execute check 6. This is the critical test.

### Step 5: Run Medium-Specific Checks

Based on `medium`, execute relevant checks.

### Step 6: Run Domain Checks

Based on `domain`, verify tone guardrails.

### Step 7: Compile Results

Categorize all issues:
- **BLOCKING** — must fix before proceeding
- **WARNING** — can proceed but note the risk

---

## DECISION LOGIC

```
IF any check FAILS with blocking issue:
  → Return to appropriate step
  → Do NOT proceed to enrichment routing

IF all checks PASS (warnings OK):
  → Proceed to Step 6 (enrichment routing)
```

### Return Destinations

| Issue Type | Return To |
|------------|-----------|
| Structural issue (traceability, dependencies) | Step 2 or 3 |
| Evidence issue | Step 4 |
| Selection issue (coverage, sufficiency) | Step 2 |
| Content classification issue | Step 1 |

---

## HARD CONSTRAINTS

- This step is DIAGNOSTIC ONLY
- Do NOT modify the graph
- Do NOT add units
- Do NOT fix issues — FLAG them
- All fixes happen by returning to earlier steps

---

## COMPLETION RULE

You are done when:
- All checks executed
- All issues categorized (blocking vs warning)
- Return destinations specified for blocking issues
- Clear PASS/FAIL status declared

---

## NEXT STEP

If PASS: `validation_result` → `steps/enrichment_routing.md`
If FAIL: Return to specified step for fixes
