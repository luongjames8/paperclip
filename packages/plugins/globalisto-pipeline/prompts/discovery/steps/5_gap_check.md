# 5: GAP CHECK

## SINGLE CONCERN

Identify potential blind spots in theme/belief coverage before proceeding to validation.

---

## PURPOSE

After beliefs are extracted and verified, check whether the coverage is adequate:
- Are all major themes represented?
- Did high-activity platforms yield beliefs?
- Are there obvious gaps we should fill?

This step decides whether to iterate back to query generation or proceed to validation.

---

## INPUT

| Input | Source |
|-------|--------|
| `verified_beliefs` | Beliefs that passed deterministic verification |
| `themes` | Themes from recon phase |
| `platform_heat_map` | Platform activity levels from recon |

---

## OUTPUT

```yaml
gaps:
  - description: "Theme T_03 (foreign worker barriers) has 0 verified beliefs"
    suggested_queries:
      - "foreign workers Japan discrimination site:reddit.com"
      - "gaijin promotion barriers Japan"
      - "diversity hiring Japan reality"

  - description: "YouTube was high-heat (65) but contributed 0 beliefs"
    suggested_queries:
      - "working in Japan vlog reality"
      - "Japanese office culture explained youtube"

decision: iterate  # or "sufficient"

coverage_stats:
  themes_with_beliefs: 4
  total_themes: 6
  high_heat_platforms_with_beliefs: 2
  high_heat_platforms_total: 3
  coverage_percentage: 67
```

---

## PROCESS

### 1. Coverage analysis

Check each dimension:

#### Theme coverage

```
For each theme in themes[]:
  count = verified_beliefs matching this theme
  if count == 0:
    flag as gap
```

#### Platform coverage

```
For each platform where heat_score >= 50:
  count = verified_beliefs with sources from this platform
  if count == 0:
    flag as gap
```

#### Belief diversity

```
Check: Are all beliefs from the same angle?
If yes: flag "perspective diversity gap"
```

### 2. Generate targeted queries for gaps

For each identified gap, generate 3-5 specific queries:

| Gap Type | Query Strategy |
|----------|----------------|
| Missing theme | Target that theme directly on multiple platforms |
| Missing platform | Target that platform with existing themes |
| Perspective gap | Search for counter-narratives and minority views |

### 3. Make iteration decision

```yaml
iterate_if:
  - 2+ themes have 0 verified beliefs
  - Highest-heat platform has 0 beliefs
  - Coverage < 60%
  - Already iterated fewer than max_iterations (1)

sufficient_if:
  - 80%+ of themes have 1+ belief
  - Already iterated once (max_iterations reached)
  - High-heat platforms all represented
```

---

## ITERATION LIMITS

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| max_iterations | 1 | Diminishing returns after one retry |
| min_new_queries | 5 | Worth iterating only if meaningful gaps |
| max_new_queries | 15 | Don't blow the search budget |

If max_iterations reached, proceed with what we have. Log the gaps for audit.

---

## CONSTRAINTS

- Gap suggestions must be specific, not generic
- Don't suggest queries already executed
- Log ALL gaps found, even if not iterating
- Never iterate more than once (max_iterations: 1)

---

## QUANTITY TARGETS

| Check | Threshold |
|-------|-----------|
| Theme coverage | 80% have 1+ belief to proceed |
| Platform coverage | All platforms with heat >= 60 have 1+ belief |
| **Minimum beliefs** | **5+ verified beliefs to proceed** |

**Why 5+:** Kill queries will cull beliefs. Starting with 5+ ensures 2-3 survivors with enough richness for 4+ angles/APs.

---

## HARD CONSTRAINTS

- If decision is `iterate`, provide 5-15 new queries
- If decision is `sufficient`, explain why gaps are acceptable
- Always calculate and report coverage_stats
- Never skip the platform coverage check

---

## COMPLETION RULE

Done when:
- Coverage analysis complete
- All gaps identified and logged
- Decision made (iterate or sufficient)
- If iterate: new queries provided
- If sufficient: reasoning documented

---

## NEXT STEP

If `iterate`:
  `suggested_queries[]` → `steps/2a_generate_queries.md` (with iteration flag)

If `sufficient`:
  `verified_beliefs[]` → `steps/5a_generate_kill_queries.md` (validation phase)
