# 2c: IDENTIFY BELIEFS (v2)

## SINGLE CONCERN

Find belief patterns in discourse items, outputting verifiable quotes.

**v2 Change:** Each belief MUST include `supporting_quotes` with URLs for deterministic verification.

---

## INPUT

| Input | Source |
|-------|--------|
| `discourse_items[]` | From step 2b (with URLs and fetch_status) |

---

## OUTPUT (v2 - REQUIRED FORMAT)

```yaml
found_beliefs:
  - id: B_01
    belief: "Young Japanese workers job-hop frequently now"
    supporting_quotes:
      - url: "https://reddit.com/r/japanlife/comments/abc123"
        quote: "Been here 10 years, just switched to my 4th company"
        discourse_item_id: D_01
      - url: "https://japantimes.co.jp/news/2024/01/job-mobility-survey"
        quote: "Survey shows 40% of workers under 35 have changed jobs"
        discourse_item_id: D_02
    category: T_01  # Theme reference
    pattern_type: ASSERTION
    status: PENDING  # Pre-verification status

  - id: B_02
    belief: "Japanese overtime is often performative, not productive"
    supporting_quotes:
      - url: "https://quora.com/What-is-working-in-Japan-really-like/answer/..."
        quote: "My wife's company still does the whole 'leave when the boss leaves' thing"
        discourse_item_id: D_03
      - url: "https://reddit.com/r/japan/comments/xyz789"
        quote: "Half my overtime is just sitting at my desk because my boss is still there"
        discourse_item_id: D_04
    category: T_02
    pattern_type: CRITIQUE
    status: PENDING
```

---

## V2 CRITICAL: SUPPORTING QUOTES

**Every belief MUST have 2+ supporting quotes with:**

| Field | Requirement |
|-------|-------------|
| `url` | Exact URL from discourse_item.url |
| `quote` | Exact text (10-500 chars) from discourse_item.excerpt |
| `discourse_item_id` | Reference to D_xx for traceability |

### Quote requirements

- Quotes must be **VERBATIM** from discourse items
- Do NOT paraphrase or summarize
- URL must match discourse_item.url exactly
- Quote must appear in discourse_item.excerpt or raw_content
- Each quote must be 10-500 characters

### Why this matters

After this step, the **verification gate** will:
1. Fetch each URL
2. Search for the exact quote
3. Mark as VERIFIED (found) or UNVERIFIED (not found)

If you fabricate quotes, they will fail verification.

---

## PROCESS

### 1. Scan items for belief signals

Look for:

| Signal | Example |
|--------|---------|
| "I think/believe..." | Direct belief statements |
| "The truth is..." | Corrective claims |
| "People don't realize..." | Insider knowledge claims |
| Defending when challenged | Someone holding a position |
| Repeated across items | Same idea from multiple sources |
| Embedded assumptions | "Why does Japan still...?" implies belief about X |

### 2. Extract quotes for each belief

For each belief identified:

1. Find ALL discourse items that support it
2. Extract the **exact quote** that expresses the belief
3. Record the URL and discourse_item_id
4. Minimum 2 quotes per belief (for verification diversity)

### 3. Group into patterns

When multiple items express similar ideas:

1. Identify the core belief being expressed
2. Collect supporting quotes from each item
3. Assign a category (theme_id from originating queries)
4. Tag the pattern type

### 4. Require evidence threshold

**Each belief MUST have 2+ supporting quotes from 2+ unique domains.**

If a belief has only 1 quote:
- Look for more discourse items supporting it
- If none found, drop the belief
- Log: "Belief dropped: insufficient evidence"

---

## QUOTE EXTRACTION RULES

### Length requirements

| Constraint | Value |
|------------|-------|
| Minimum | 10 characters |
| Maximum | 500 characters |
| Preferred | Complete sentences |

### What to extract

```
GOOD: "Survey shows 40% of workers under 35 have changed jobs at least once"
     (Complete claim with data)

BAD:  "40%"
     (Too short, no context)

BAD:  "The survey, which was conducted by the Ministry of Health, Labour and
       Welfare in collaboration with various industry associations and labor
       unions across all 47 prefectures of Japan over a six-month period
       ending in December 2023, with a sample size of 50,000 respondents
       weighted by age, gender, and industry..." [600+ chars]
     (Too long, include just the key claim)
```

### Quote selection priority

1. **Specific claims** - Numbers, percentages, named entities
2. **First-person experience** - "I've been here 10 years..."
3. **Corrective statements** - "Actually, it's not like..."
4. **Strong assertions** - Clear position statements

### What NOT to include

- Navigation/footer text
- Advertisement content
- Text inside `<blockquote>` (already quoted elsewhere)
- Code blocks or technical content unrelated to belief

---

## ATOMIC BELIEF PRESERVATION (from v1)

**CRITICAL:** Do NOT absorb specific findings into broader patterns.

| Type | Example | Preserve as |
|------|---------|-------------|
| Numeric/percentage | "97% of servers prefer tipping" | Standalone belief |
| Distributional | "Gen Z 43% vs Boomers 84% always tip" | Standalone belief |
| Reverses intuition | "Servers earn $35-50/hr" | Standalone belief |
| Specific behavior | "Workers hire agencies to quit for them" | Standalone belief |

Ask: **Is this specific finding MORE interesting than the generic pattern it could support?**

---

## PATTERN TYPES

| Type | Description |
|------|-------------|
| ASSERTION | Stating something as true |
| CRITIQUE | Challenging common view |
| COMPLAINT | Expressing frustration with reality |
| CORRECTION | "Actually, it's not like that" |
| OBSERVATION | Personal experience supporting belief |

---

## QUANTITY TARGETS

- Extract 3-8 distinct belief patterns
- Each pattern MUST have 2+ supporting quotes
- Quotes MUST be from 2+ unique domains
- Single-quote beliefs are REJECTED

---

## HARD CONSTRAINTS

- Identify beliefs ONLY (do not classify or evaluate)
- Each belief MUST have `supporting_quotes` array
- Quotes must be VERBATIM from discourse items
- URL must match discourse_item.url exactly
- Quote must be 10-500 characters
- Each belief needs 2+ quotes from 2+ domains
- **PRESERVE atomic findings** - do not absorb specific data/stats into generic claims
- Assign status: PENDING for all beliefs (verification comes next)

---

## PRE-VERIFICATION CHECKS

Before outputting, verify:

- [ ] Every belief has 2+ supporting_quotes
- [ ] Every quote has url, quote text, and discourse_item_id
- [ ] Every quote is 10-500 characters
- [ ] Quotes are from 2+ unique domains per belief
- [ ] All URLs exist in discourse_items
- [ ] All quotes appear in discourse_item.excerpt or raw_content

---

## COMPLETION RULE

Done when:
- Distinct belief patterns identified
- Each pattern has 2+ supporting_quotes
- Quotes are verbatim with URLs
- Pattern types assigned
- Beliefs are specific and falsifiable
- Category (theme_id) assigned

---

## NEXT STEP

`found_beliefs[]` → **VERIFICATION GATE** (deterministic.ts) → `steps/5_gap_check.md`

The verification gate will:
1. Fetch each URL
2. Check if quote exists on page (95% fuzzy match)
3. Calculate points: VERIFIED=2, SUPPORTED=1, UNVERIFIED=0
4. Accept/reject beliefs based on: min_points=3, min_verified=1, min_domains=2
