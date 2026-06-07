# STEP 3: BEAT GENERATION

## PURPOSE

Generate potential beats from evidence. Maximize unique options for Structure.

This step answers: "What narrative units could we build from these facts?"

---

## INPUT

| Input | Source |
|-------|--------|
| `raw_evidence` | From Step 2 (facts organized by slot) |
| `belief` | The belief being addressed |

---

## OUTPUT

### `potential_beats.yaml`

```yaml
potential_beats:
  - id: PB_01
    slot_id: AP_01
    description: "[What this beat says - neutral, factual]"
    belief_pressure: "[How this pressures the belief]"
    type: reveal | contradiction | escalation | irony | origin | reversal
    evidence_refs: [EV_001, EV_002]
    source: domain_pull | fresh_research | gap_research
```

---

## BEAT GENERATION PROCESS

### Step 1: Group Related Evidence

Within each slot, cluster related findings:
- Same event from different angles
- Related data points
- Quote + context

### Step 2: Generate Beats from Clusters

Each cluster can become 1+ beats.

| Cluster Type | Beat Potential |
|--------------|----------------|
| Single strong fact | 1 beat |
| Complementary facts | 1 beat (combined) |
| Contrasting facts | 2+ beats (tension) |
| Rich event | 2-3 beats (different angles) |

### Step 3: Assign Beat Type

Every beat gets exactly one type:

| Type | Definition | Example |
|------|------------|---------|
| **reveal** | Surfaces hidden truth | "Internal memo shows Toyota knew about battery issues" |
| **contradiction** | Exposes inconsistency | "Toyota claimed EV commitment while cutting R&D budget" |
| **escalation** | Intensifies pressure | "Not just one market - Toyota losing share globally" |
| **irony** | Unexpected reversal | "Toyota pioneered hybrids, now trailing in EVs" |
| **origin** | Traces cause | "Decision to delay EVs traces to 2018 strategy meeting" |
| **reversal** | Flips expectation | "Their 'wait and see' approach now seen as fatal delay" |

### Step 4: Articulate Belief Pressure

For each beat, explicitly state how it pressures the belief.

```yaml
description: "Toyota's China EV market share dropped from 4.2% to 2.1% in 18 months"
belief_pressure: |
  Directly challenges any claim that Toyota's EV strategy is working.
  Quantifies the cost of delay in the world's largest EV market.
```

---

## UNIQUENESS REQUIREMENT

**No two beats should say the same thing.**

### Uniqueness Test

For each new beat, ask:
1. Does another beat already make this point?
2. Would keeping both feel redundant to Structure?
3. Can these be combined into one stronger beat?

| Situation | Action |
|-----------|--------|
| Same point, different evidence | Combine into one beat with multiple refs |
| Related but distinct points | Keep as separate beats |
| Redundant beats | Keep the stronger one, drop the weaker |

### Example: Redundancy

```yaml
# Redundant - drop one
beat_1: "Toyota sales in China declined 15%"
beat_2: "Toyota's China market share fell significantly"

# Distinct - keep both
beat_1: "Toyota sales in China declined 15%"
beat_2: "BYD sales in China grew 40% in same period"
```

---

## FLOOR: 5 BEATS PER SLOT

Generate at least 5 unique beats per slot.

| If you have... | Do this |
|----------------|---------|
| 10+ good findings | Generate 7-10 beats, focus on strongest |
| 5-9 findings | Generate beat for each, combine where natural |
| < 5 findings | Generate what you can, flag as THIN |

**This is a FLOOR, not a ceiling.** If material supports 15 beats, generate 15.

---

## BEAT DESCRIPTION RULES

### Be Specific

| Vague | Specific |
|-------|----------|
| "Toyota is struggling with EVs" | "Toyota's bZ4X sold 24,000 units globally vs Tesla Model Y's 1.2 million in 2023" |
| "Leadership made bad decisions" | "Akio Toyoda publicly dismissed EV-only future as 'overhyped' in January 2024" |

### Stay Factual

The beat description states WHAT. The pressure field explains WHY IT MATTERS.

| Description (what) | Pressure (why) |
|--------------------|----------------|
| "Toyota bZ4X recalled for wheel detachment risk in 2022" | "First major EV undermined by quality issues, damaging EV credibility" |

### Include Attribution

When relevant, include who said/did what:
- "Akio Toyoda stated..."
- "According to Toyota's 10-K filing..."
- "Bloomberg reported that..."

---

## EVIDENCE LINKING

Every beat MUST link to evidence.

```yaml
evidence_refs: [EV_001, EV_002]
```

| Rule | Enforcement |
|------|-------------|
| At least 1 evidence ref per beat | Required |
| Multiple refs strengthen beat | Preferred |
| No evidence = no beat | Absolute |

---

## HARD CONSTRAINTS

- Minimum 5 beats per slot (floor)
- No maximum (more unique = better)
- Every beat has type assignment
- Every beat has belief_pressure articulated
- Every beat links to evidence
- No duplicate/redundant beats
- No invented facts

---

## COMPLETION RULE

You are done when:
- All slots have 5+ beats (or flagged THIN)
- Each beat has type, description, pressure, evidence_refs
- No redundant beats
- Evidence trail complete

---

## NEXT STEP

`potential_beats` → `steps/counter_evidence.md`

Now actively seek what would weaken the angle.
