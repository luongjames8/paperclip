# 4b: SCORE BONAFIDE

## SINGLE CONCERN

Aggregate discourse classifications into a bonafide score for a belief.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The candidate belief being validated |
| `classifications[]` | From step 4a (all related items classified) |

---

## OUTPUT

```yaml
belief: "Japanese workers are expected to stay at one company forever"

bonafide_score: HIGH | MEDIUM | LOW
recency: HOT | NORMAL | STALE

breakdown:
  sincere_count: 5
  strawman_count: 2
  neutral_count: 3
  total: 10

  sincere_sources: ["reddit", "forum", "youtube"]
  source_diversity: 3

  sincere_items:
    - id: D_01
      date: "2024-02"
      excerpt: "I still feel pressure to stay..."
    - id: D_05
      date: "2024-01"
      excerpt: "My boss talks about loyalty..."
    # ... more

  most_recent_sincere: "2024-02"

scoring_reason: |
  5 SINCERE items from 3 distinct sources qualifies as HIGH bonafide.
  Most recent SINCERE within 6 months = HOT.
```

---

## SCORING RULES

### Bonafide Score

| Score | Criteria |
|-------|----------|
| **HIGH** | 3+ SINCERE items from 2+ distinct sources |
| **MEDIUM** | 1-2 SINCERE items OR 3+ from single source only |
| **LOW** | 0 SINCERE items (all strawman/neutral) |

### Recency

| Rating | Criteria |
|--------|----------|
| **HOT** | Most recent SINCERE item < 6 months old |
| **NORMAL** | Most recent SINCERE within 6-12 months |
| **STALE** | Most recent SINCERE > 12 months old |

### Source Diversity

Count distinct source types (reddit, youtube, forum, article, etc.):
- 3+ sources = strong diversity
- 2 sources = adequate diversity
- 1 source = weak (even with many items)

---

## PROCESS

1. **Count classifications**
   - Tally SINCERE, STRAWMAN, NEUTRAL

2. **Check source diversity**
   - List distinct sources with SINCERE items
   - Count unique source types

3. **Apply scoring rules**
   - Determine bonafide score
   - Check most recent SINCERE date for recency

4. **Document evidence**
   - List SINCERE items with excerpts
   - Note dates for recency assessment

---

## EDGE CASES

| Case | Handling |
|------|----------|
| All HIGH confidence classifications | Trust the counts |
| Many LOW confidence classifications | Note uncertainty in scoring_reason |
| Borderline (exactly 3 from 2 sources) | Score as HIGH but note borderline |
| Old SINCERE + recent STRAWMAN | Still valid if SINCERE exists (strawman confirms belief is known) |

---

## HARD CONSTRAINTS

- Apply scoring rules exactly as defined
- Bonafide = do people HOLD the belief, not is it TRUE
- Source diversity matters (single-source is weaker)
- Do not make GO/NO-GO decision (that's step 4d)
- Do not assess interest (that's step 4c)

---

## COMPLETION RULE

Done when:
- Classification counts tallied
- Source diversity assessed
- Bonafide score assigned per rules
- Recency determined
- Evidence documented

---

## NEXT STEP

`bonafide_score` + `recency` → `steps/4c_evaluate_interest.md`
