# 4c: EVALUATE INTEREST

## SINGLE CONCERN

Assess audience interest signals for a belief topic, including surprise value.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The candidate belief |
| `discourse_items[]` | All related discourse items |
| `source_path` | From step 3b (intersection / bottom_up_only / top_down_only) |

---

## OUTPUT

```yaml
belief: "Japanese workers are expected to stay at one company forever"

interest_score: HIGH | MEDIUM | LOW

signals:
  discourse_recency:
    rating: HIGH
    evidence: "5 items from last 3 months"

  thread_activity:
    rating: HIGH
    evidence: "Multiple threads with 50+ comments"

  content_freshness:
    rating: MEDIUM
    evidence: "Recent discussions but fewer new articles/videos"

  engagement_quality:
    rating: HIGH
    evidence: "Actual debates, not just questions"

  surprise_value:
    rating: HIGH
    evidence: "Counter-narrative - contradicts common assumption that lifetime employment is dying"
    obviousness_check: "NOT on first page of Google for this topic"

interest_reason: |
  Active recent discussions with genuine engagement.
  People are still arguing about this, not just asking.
  HIGH surprise value - challenges expectations rather than confirming them.
```

---

## INTEREST SIGNALS

### Discourse Recency

How recent is the discourse?

| Rating | Criteria |
|--------|----------|
| HIGH | Multiple items from last 6 months |
| MEDIUM | Items mostly 6-12 months old |
| LOW | Items mostly > 12 months old |

### Thread Activity

How engaged are the discussions?

| Rating | Criteria |
|--------|----------|
| HIGH | Active threads, many replies, ongoing debates |
| MEDIUM | Some replies, moderate engagement |
| LOW | Dead posts, unanswered questions |

### Content Freshness

Is new content still being created?

| Rating | Criteria |
|--------|----------|
| HIGH | Recent videos, articles, podcasts about topic |
| MEDIUM | Some recent content |
| LOW | Only old/evergreen content exists |

### Engagement Quality

Are people genuinely interested or just passing through?

| Rating | Criteria |
|--------|----------|
| HIGH | Debates, disagreements, personal investment |
| MEDIUM | Questions and answers, some engagement |
| LOW | Drive-by comments, no real discussion |

### Surprise Value (CRITICAL)

Does this belief offer something non-obvious? **This signal can VETO otherwise high-scoring beliefs.**

| Rating | Criteria |
|--------|----------|
| HIGH | Counter-narrative, challenges assumptions, "I didn't know that" reaction |
| MEDIUM | Adds nuance to known topic, specific angle on general trend |
| LOW | Obvious, first-page-of-Google, "everyone knows this" |

**Obviousness test:** Ask "Would this appear on the first page of Google results for this topic?"
- YES → LOW surprise value (penalize)
- NO → Potentially HIGH surprise value

**Source path bonus:**
| source_path | Surprise adjustment |
|-------------|---------------------|
| bottom_up_only | +1 tier (unexpected discovery) |
| intersection | no adjustment |
| top_down_only | -1 tier (AI predicted = likely obvious) |

**Examples:**

| Belief | Surprise Rating | Why |
|--------|-----------------|-----|
| "Tipping is out of control" | LOW | Everyone complaining about this, obvious |
| "Servers prefer tipping system" | MEDIUM | Counter to consumer narrative |
| "Gen Z tips 43% vs Boomers 84%" | HIGH | Specific, surprising stat, generational tension |
| "97% of servers prefer tipping" | HIGH | Specific counter-data, challenges reform narrative |

---

## OVERALL INTEREST SCORE

| Overall | How to determine |
|---------|------------------|
| HIGH | 3+ signals are HIGH, AND surprise_value is not LOW |
| MEDIUM | Mix of HIGH and MEDIUM, no LOW |
| LOW | Any critical signal is LOW, OR surprise_value is LOW with no compensating factors |

**CRITICAL: Surprise value can downgrade otherwise high scores.**

| Other signals | surprise_value | Final score |
|---------------|----------------|-------------|
| All HIGH | LOW | **MEDIUM** (capped - too obvious) |
| All HIGH | MEDIUM | HIGH |
| All HIGH | HIGH | HIGH (prioritize) |
| Mixed | LOW | LOW (reject obvious beliefs) |

**Note:** Interest ≠ bonafide. A belief can be:
- HIGH bonafide, LOW interest (people hold it but nobody cares to discuss)
- LOW bonafide, HIGH interest (people love attacking a strawman)

---

## HARD CONSTRAINTS

- Assess interest ONLY (not bonafide, not truth)
- Base on discourse evidence
- Consider ALL FIVE signal types (including surprise_value)
- Surprise value can cap or downgrade otherwise high scores
- Do not make GO/NO-GO decision (that's step 4d)

---

## COMPLETION RULE

Done when:
- All FIVE interest signals evaluated (recency, activity, freshness, engagement, surprise)
- Each signal has evidence
- Surprise value includes obviousness check
- Overall interest score assigned (respecting surprise value caps)
- Interest reason documented

---

## NEXT STEP

`interest_score` → `steps/4d_make_decision.md`
