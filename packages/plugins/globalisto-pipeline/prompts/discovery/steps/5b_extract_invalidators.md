# 5b: EXTRACT INVALIDATORS

## SINGLE CONCERN

Find evidence from search results that contradicts the belief.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The belief being invalidation-tested |
| `raw_results` | Search results from kill queries |

---

## OUTPUT

```yaml
belief: "Japanese workers are expected to stay at one company forever"

invalidators:
  - id: INV_01
    type: DATA
    claim: "Japanese job tenure has decreased 30% since 1990s"
    source: "Ministry of Labor statistics"
    strength: STRONG
    excerpt: |
      "Average job tenure for workers under 35 has fallen from
      8.5 years in 1995 to 4.2 years in 2023..."

  - id: INV_02
    type: EXPERT
    claim: "Lifetime employment only ever applied to ~30% of workforce"
    source: "Prof. Takahashi, Tokyo University"
    strength: STRONG
    excerpt: |
      "The popular image of universal lifetime employment is a myth.
      Even at its peak, this practice was limited to large corporations
      and male workers..."

  - id: INV_03
    type: NUANCE
    claim: "Practice varies dramatically by company size and industry"
    source: "Japan Times analysis"
    strength: MODERATE
    excerpt: |
      "While some traditional industries maintain old practices,
      tech startups and foreign companies operate very differently..."

  - id: INV_04
    type: TREND
    claim: "Younger generation actively rejects lifetime employment concept"
    source: "Survey data, Nikkei"
    strength: MODERATE
    excerpt: |
      "Only 23% of workers under 30 said they expect to stay at their
      current company until retirement, down from 67% in 2000..."

no_invalidators_found: false

invalidator_summary: |
  Found 4 significant invalidators:
  - Statistical evidence of declining tenure
  - Expert debunking of universality myth
  - Nuance about applicability
  - Generational attitude shift
```

---

## INVALIDATOR TYPES

| Type | What it is | Example |
|------|------------|---------|
| DATA | Statistics, studies that contradict | "Tenure has declined 30%" |
| EXPERT | Authoritative person disagreeing | "Professor X says this is wrong" |
| NUANCE | Complexity that undermines simple belief | "Only applies to large firms" |
| TREND | Change over time that invalidates | "Was true in 1980, not now" |
| COUNTEREXAMPLE | Specific case that disproves | "Company X does opposite" |

## INVALIDATOR STRENGTH

| Strength | Criteria |
|----------|----------|
| STRONG | Would convince a reasonable believer to change mind |
| MODERATE | Raises doubts but doesn't fully disprove |
| WEAK | Minor point, easily dismissed |

---

## PROCESS

1. **Scan results** for counter-evidence
2. **Identify** specific claims that contradict belief
3. **Extract** verbatim excerpts
4. **Classify** type and strength
5. **Note** if no invalidators found

### What counts as an invalidator?

| Include | Exclude |
|---------|---------|
| Evidence that belief is false | Someone just disagreeing |
| Data that contradicts | Opinions without evidence |
| Expert analysis with reasoning | Random internet comments |
| Documented trends against belief | Isolated anecdotes |

### Be rigorous

- Invalidators must actually contradict the belief
- Strength must be honest (don't inflate weak points)
- Look for the strongest counter-evidence available

---

## HARD CONSTRAINTS

- Extract ACTUAL counter-evidence (not opinions)
- Include verbatim excerpts
- Rate strength honestly
- Note if no invalidators found
- Do NOT evaluate survival (that's step 5c)

---

## COMPLETION RULE

Done when:
- All relevant counter-evidence extracted
- Each invalidator has type, claim, source, strength, excerpt
- Summary of invalidator findings
- Honest assessment if none found

---

## NEXT STEP

`invalidators[]` → `steps/5c_evaluate_survival.md`
