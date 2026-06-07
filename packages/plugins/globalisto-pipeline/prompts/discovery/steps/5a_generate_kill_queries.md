# 5a: GENERATE KILL QUERIES

## SINGLE CONCERN

Generate search queries designed to DISPROVE the validated belief.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The validated belief to attempt to kill |

---

## OUTPUT

```yaml
belief: "Japanese workers are expected to stay at one company forever"

kill_queries:
  direct_contradiction:
    - "lifetime employment myth debunked"
    - "Japanese workers job hopping statistics"
    - "why lifetime employment is false"

  counter_evidence:
    - "Japan job turnover rates 2024"
    - "Japanese millennials changing jobs"
    - "lifetime employment declining Japan"

  expert_critique:
    - "economists criticism lifetime employment Japan"
    - "Japanese work culture overhyped"
    - "stereotypes about Japanese workers wrong"

  steel_man_opposition:
    - "best arguments against lifetime employment myth"
    - "what people get wrong about Japanese work"
    - "nuanced view Japanese employment"

query_purpose: |
  These queries search for evidence that would KILL this belief.
  If strong invalidators exist, the belief may not survive.
```

---

## PROCESS

### Think adversarially

Ask: "What would prove this belief WRONG?"

| Question | Query Angle |
|----------|-------------|
| What data contradicts this? | Statistics, studies |
| Who disagrees with this? | Expert critiques |
| What's the strongest counter-argument? | Steel-man opposition |
| When was this proven false? | Debunking articles |
| What nuances invalidate the simple version? | "Actually" takes |

### Query categories

| Category | Purpose | Example |
|----------|---------|---------|
| `direct_contradiction` | Flat-out "this is false" content | "[belief] myth debunked" |
| `counter_evidence` | Data/facts that contradict | "[contrary stats] [topic]" |
| `expert_critique` | Authoritative disagreement | "experts criticize [belief]" |
| `steel_man_opposition` | Strongest form of counter-argument | "best arguments against [belief]" |

### Steel-man, don't straw-man

Find the STRONGEST case against the belief, not the weakest:
- What would a thoughtful critic say?
- What's the most compelling counter-evidence?
- What nuance makes the simple belief inadequate?

---

## EXAMPLE KILL QUERIES

For belief: "AI will replace all jobs"

```yaml
kill_queries:
  direct_contradiction:
    - "AI job replacement overhyped"
    - "why AI won't take all jobs"
    - "AI job fears overblown"

  counter_evidence:
    - "jobs AI cannot replace 2024"
    - "AI limitations in workplace"
    - "employment growth despite AI"

  expert_critique:
    - "economists AI job predictions wrong"
    - "MIT study AI employment"
    - "historical automation job fears wrong"

  steel_man_opposition:
    - "nuanced view AI employment future"
    - "what AI doomers get wrong"
    - "AI complementing not replacing workers"
```

---

## QUANTITY TARGET

- 8-12 kill queries total
- Cover all four categories
- Focus on finding STRONG invalidators

---

## HARD CONSTRAINTS

- Generate queries to DISPROVE, not confirm
- Seek steel-man counter-arguments (strongest opposition)
- Do NOT search (orchestrator handles)
- Do NOT prejudge if belief will survive

---

## COMPLETION RULE

Done when:
- All four query categories covered
- 8-12 queries generated
- Queries target strongest counter-evidence
- Query purpose documented

---

## NEXT STEP

`kill_queries[]` → SEARCH (orchestrator) → `steps/5b_extract_invalidators.md`
