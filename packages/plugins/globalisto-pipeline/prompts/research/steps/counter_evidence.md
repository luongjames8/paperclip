# STEP 4: COUNTER-EVIDENCE SEARCH

## PURPOSE

Actively search for what would weaken the angle. Add as beats.

This step answers: "What would make our angle wrong or incomplete?"

**This step is MANDATORY.** Skipping it produces propaganda, not analysis.

---

## INPUT

| Input | Source |
|-------|--------|
| `potential_beats` | From Step 3 (beats organized by slot) |
| `belief` | The belief being addressed |
| `ANGLE_LOCK.yaml` | From Angle Generation (provisional lock) |

---

## OUTPUT

### `potential_beats.yaml` (updated)

Original beats plus counter-evidence beats:

```yaml
potential_beats:
  # ... existing beats ...

  # Counter-evidence beats added
  - id: PB_CE_01
    slot_id: COUNTER  # Special slot for counter-evidence
    description: "[Counter-evidence fact]"
    belief_pressure: "[How this SUPPORTS or COMPLICATES the belief]"
    type: contradiction | reveal
    evidence_refs: [EV_XXX]
    source: fresh_research
    counter_evidence: true  # Flag
```

---

## WHY COUNTER-EVIDENCE MATTERS

| Without Counter-Evidence | With Counter-Evidence |
|--------------------------|----------------------|
| One-sided argument | Balanced analysis |
| Easily dismissed | Pre-emptively addresses objections |
| Audience distrust | Audience trusts thoroughness |
| Propaganda | Journalism |

**Structure decides what to use.** Research finds ALL relevant material.

---

## ADVERSARIAL TRACK

Before executing any searches, read `ANGLE_LOCK.yaml` to identify the locked angle's specific claim:

- ADVERSARIAL TRACK: Search for evidence that CHALLENGES the locked angle
- You are trying to BREAK the angle — find the strongest counter-arguments
- Use DeepSeek reasoning via the deepseek CLI (`deepseek chat --thinking true`) for this step
- This is NOT generic "balance" — actively seek to disprove the title's claim
- If counter-evidence is devastating, this signals a pivot may be needed

---

## COUNTER-EVIDENCE SEARCH PROCESS

### Step 1: Identify the Angle's Weak Points

Review the belief and existing beats. Ask:
- What would make this belief TRUE?
- Where is the argument most vulnerable?
- What would a defender of the belief say?
- What evidence would embarrass this angle?

### Step 2: Generate Counter-Queries

Create specific search queries for counter-evidence.

| Angle | Counter-Query |
|-------|---------------|
| "Toyota's EV strategy is failing" | "Toyota EV strategy success" |
| | "Toyota hybrid sales growth 2024" |
| | "Why Toyota EV delay was strategic" |
| | "Toyota solid-state battery breakthrough" |

**Search actively.** Don't just note that counter-evidence might exist.

### Step 3: Extract Counter-Evidence

Apply same extraction standards as Step 2:
- Specific facts, not vague claims
- Attributed sources
- Neutral language
- Credibility assessment

### Step 4: Generate Counter-Beats

Create beats from counter-evidence using same process as Step 3.

```yaml
- id: PB_CE_01
  slot_id: COUNTER
  description: "Toyota's hybrid sales grew 20% in 2024, generating $X billion profit"
  belief_pressure: |
    Suggests Toyota's hybrid-focused strategy is financially sound.
    Counter-argument: Why rush to EVs when hybrids print money?
  type: contradiction
  evidence_refs: [EV_045]
  source: fresh_research
  counter_evidence: true
```

---

## COUNTER-EVIDENCE CATEGORIES

### Category 1: Direct Refutation

Evidence that directly challenges the angle.

| Angle Claim | Counter-Evidence |
|-------------|------------------|
| "Toyota is losing the EV race" | "Toyota leads in hybrid-EV total" |
| "Leadership in denial" | "Akio Toyoda's detailed EV roadmap speech" |

### Category 2: Complicating Factors

Evidence that adds nuance without refuting.

| Angle Claim | Complicating Evidence |
|-------------|----------------------|
| "Toyota delayed EVs" | "EV battery supply constraints affected all OEMs" |
| "China market loss" | "Toyota gained share in US and Japan" |

### Category 3: Alternative Interpretation

Evidence supporting a different reading of the same facts.

| Angle Reading | Alternative Reading |
|---------------|---------------------|
| "Delay was strategic error" | "Delay preserved capital during EV unprofitability" |
| "Missing the EV revolution" | "Waiting for solid-state gives long-term advantage" |

---

## MINIMUM COUNTER-EVIDENCE REQUIREMENT

| Total Beats | Minimum Counter-Evidence |
|-------------|--------------------------|
| < 20 beats | At least 3 counter-beats |
| 20-40 beats | At least 5 counter-beats |
| > 40 beats | At least 7 counter-beats |

**These are FLOORS.** If more counter-evidence exists, capture it.

---

## STEEL-MANNING RULE

Present counter-evidence at its STRONGEST, not weakest.

| Weak Steel-Man | Strong Steel-Man |
|----------------|------------------|
| "Some say Toyota is doing fine" | "Toyota's 2024 hybrid profits exceeded all EV competitors combined" |
| "Critics disagree" | "Industry analysts rate Toyota's solid-state battery program as most advanced" |

**If the counter-argument has merit, present it with full force.**

Structure will decide how to address it. Research captures the strongest version.

---

## INVALIDATION CHECK

Sometimes counter-evidence is strong enough to invalidate the angle.

### Invalidation Signals

- Counter-evidence directly disproves core premise
- Multiple high-credibility sources contradict angle
- Key fact in angle is demonstrably false

### Invalidation Handling

```yaml
invalidation_flag:
  triggered: true
  reason: "[What makes the angle invalid]"
  evidence_refs: [EV_XXX, EV_YYY]
  recommendation: STOP_PIPELINE | PIVOT_ANGLE | NOTE_AND_CONTINUE
```

Behavior depends on `invalidation_behavior` config:
- `STOP_PIPELINE`: Halt and report (globalisto)
- `NOTE_IT`: Flag but continue (most repos)

---

## HARD CONSTRAINTS

- Counter-evidence search is MANDATORY
- Minimum counter-beats based on total beats
- Steel-man counter-arguments (strongest version)
- Same extraction standards as positive evidence
- Flag invalidation if discovered
- Tag all counter-beats with `counter_evidence: true`
- MUST produce genuine counter-evidence, not strawmen
- Minimum 2 substantive counter-evidence items (validated by research:adversarial_coverage gate)
- Counter-evidence should be strong enough to make a reasonable person doubt the angle

---

## COMPLETION RULE

You are done when:
- Counter-queries executed for each major angle claim
- Counter-evidence extracted and documented
- Counter-beats generated (minimum met)
- Steel-man principle applied
- Invalidation check completed
- All counter-beats tagged

---

## NEXT STEP

`potential_beats` (with counter-evidence) → `steps/coverage_validation.md`

Validate coverage and uniqueness.
