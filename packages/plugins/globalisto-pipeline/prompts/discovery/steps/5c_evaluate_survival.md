# 5c: EVALUATE SURVIVAL

## SINGLE CONCERN

Determine if the belief survives the invalidation attempt.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The belief being tested |
| `invalidators[]` | From step 5b |

---

## OUTPUT

```yaml
belief: "Japanese workers are expected to stay at one company forever"

survival_verdict: KILLED | SURVIVES | WOUNDED

invalidator_impact:
  strong_count: 2
  moderate_count: 2
  weak_count: 0

survival_analysis: |
  The belief as stated is KILLED.

  The invalidators show:
  1. Lifetime employment was never universal (only ~30% of workforce)
  2. Current statistics show significant decline in job tenure
  3. Generational shift away from the practice

  The SIMPLE form of this belief cannot survive this evidence.

  However, a REFINED belief might survive:
  "The EXPECTATION of lifetime employment persists in Japanese culture,
  even though the PRACTICE has declined significantly."

refined_belief: |
  "The expectation of lifetime employment persists in Japanese workplace
  culture, even though actual job tenure has declined significantly,
  especially among younger workers."

refinement_note: |
  If the refined belief is acceptable, it SURVIVES in modified form.
  This refined belief is still a CLAIM (expectation persists), not just
  an observation about tension.

content_angle: |
  The gap between expectation and reality makes this a DETONATOR -
  content can challenge the simple "lifetime employment" stereotype.
```

---

## SURVIVAL VERDICTS

### KILLED

The belief cannot survive the invalidators.

**Criteria:**
- Multiple STRONG invalidators
- Core claim is factually wrong
- No reasonable refinement saves it

**Next action:** Drop this belief, try next candidate

### SURVIVES

The belief withstands invalidation attempts.

**Criteria:**
- No STRONG invalidators found
- Invalidators address edge cases, not core claim
- Evidence supports belief more than contradicts

**Next action:** Proceed to slot generation

### WOUNDED

The simple form fails but a refined version survives.

**Criteria:**
- STRONG invalidators exist BUT
- A more nuanced formulation remains valid
- The refined version is still content-worthy

**Next action:** Use refined belief for slot generation

---

## EVALUATION PROCESS

### Step 1: Assess invalidator weight

| Scenario | Impact |
|----------|--------|
| 2+ STRONG invalidators | Likely KILLED |
| 1 STRONG + moderates | Possibly WOUNDED |
| Only MODERATE/WEAK | Likely SURVIVES |
| No invalidators | Definitely SURVIVES |

### Step 2: Test core claim

Ask: "Is the fundamental assertion still defensible?"

| If answer is... | Verdict |
|-----------------|---------|
| No, it's factually wrong | KILLED |
| Partially, with refinement | WOUNDED |
| Yes, invalidators are weak | SURVIVES |

### Step 3: Consider refinement (if WOUNDED)

If the simple belief fails but core insight remains:
- Formulate refined belief
- Check if refined version is still content-worthy
- Note what makes the refinement interesting
- **Apply the Sharpness Test before accepting**

### Step 4: Identify content angle

WOUNDED beliefs often reveal content angles:
- Gap between perception and reality → becomes an ANGLE
- Nuance that makes simple view inadequate → becomes an ANGLE
- Contradiction that creates "actually" moment → becomes DETONATOR potential

IMPORTANT: The refined belief must still be a CLAIM the audience holds, not a meta-observation like "there's tension between X and Y" or "the system is in transition".

---

## REFINEMENT SHARPNESS TEST

**CRITICAL:** Refinement must preserve surprise. A bland refinement is worse than KILLED.

Before accepting a refined belief, verify:

| Question | If NO → |
|----------|---------|
| Does it still surprise on first read? | **REJECT refinement** |
| Does it create an "actually..." moment? | **REJECT refinement** |
| Would a smart reader say "wait, really?" | **REJECT refinement** |
| Does it preserve specific data/numbers? | **REJECT refinement** |

### Bad refinement (kills tension)

```yaml
original: "Servers earn $35-50/hr and 97% oppose abolishing tipping"
refined: "The tipping system has varied stakeholder impacts"
verdict: REJECT
reason: Academic blandness - no surprise, no hook, no tension
```

```yaml
original: "Gen Z tips 43% of the time vs Boomers at 84%"
refined: "Tipping practices vary by generation"
verdict: REJECT
reason: Lost the specific data that made it interesting
```

### Good refinement (preserves tension)

```yaml
original: "Japanese workers stay at one company forever"
refined: "The EXPECTATION of lifetime employment persists even though the PRACTICE has declined"
verdict: ACCEPT
reason: Still creates "wait, the expectation persists?" moment
```

```yaml
original: "Nobody tips anymore"
refined: "Tipping is declining among younger customers (43% Gen Z vs 84% Boomers always tip)"
verdict: ACCEPT
reason: Preserves the specific data and sharpens the claim
```

### When refinement fails the sharpness test

If refinement removes the surprise/tension:
1. Consider if KILLED is more honest than a bland WOUNDED
2. Look for alternative refinements that preserve the surprise
3. If no sharp refinement exists → mark as KILLED with note: "refinement would kill tension"

**Better to KILL a belief than to let a bland refinement through.**

---

## EXAMPLES

### KILLED Example
```yaml
belief: "Nobody in Japan uses cash anymore"
invalidators:
  - STRONG: "Japan remains one of most cash-dependent economies"
  - STRONG: "Only 30% of transactions are cashless vs 60% in Korea"
survival_verdict: KILLED
reason: "Factually wrong. Multiple strong data points contradict."
```

### SURVIVES Example
```yaml
belief: "Japanese convenience stores are remarkably efficient"
invalidators:
  - WEAK: "Some stores have staffing issues"
  - WEAK: "Rural stores less impressive"
survival_verdict: SURVIVES
reason: "Core claim holds. Invalidators are edge cases."
```

### WOUNDED Example
```yaml
belief: "Japanese workers stay at one company forever"
invalidators:
  - STRONG: "Tenure declining, especially for young workers"
  - STRONG: "Practice was never universal"
survival_verdict: WOUNDED
refined_belief: "The EXPECTATION persists even as practice declines"
reason: "Simple form fails, but interesting tension emerges."
```

---

## HARD CONSTRAINTS

- Be honest about survival (don't save weak beliefs)
- KILLED beliefs must not proceed
- WOUNDED beliefs must have valid refinement
- **Refined beliefs MUST pass the sharpness test** - reject bland refinements
- **Better to KILL than accept tension-killing refinement**
- Document reasoning clearly
- Identify content angles even in failure

---

## COMPLETION RULE

Done when:
- Invalidator impact assessed
- Survival verdict assigned
- Analysis explains reasoning
- If WOUNDED: refined belief formulated AND passes sharpness test
- Content angle identified

---

## NEXT STEP

**If SURVIVES/WOUNDED:** → `steps/6a_determine_content_class.md`

**If KILLED:** Try next validated candidate. If ALL candidates killed, loop back to Phase 1 for more candidates.
