# STEP 1B: SERP ECOSYSTEM AUDIT

## PURPOSE
Validate that each proposed title routes to the correct YouTube ecosystem before human selection. A 60-second sanity check that catches obvious keyword-to-ecosystem mismatches — like "German Engineering" landing in automotive/car review results instead of business documentary.

> **Important context:** This tests keyword-to-search associations. Search ≠ recommendation, but it catches obvious mismatches like "German Engineering" routing to car reviews. It's a sanity check, not a guarantee.

## INPUT
| Input | Source |
|-------|--------|
| `ANGLE_PROPOSAL_A.yaml` | From Step 1 (YouTube Strategist) |
| `ANGLE_PROPOSAL_B.yaml` | From Step 1 (Documentary Filmmaker) |
| `ANGLE_PROPOSAL_C.yaml` | From Step 1 (Adversarial Journalist) |

## Pre-Fetched YouTube Search Results

The following YouTube search results for each proposal title have been pre-fetched. Analyze them directly — do NOT attempt to call any tools.

{pre_fetched_data}

## PROCESS

Run TWO checks on each of the 3 proposals:

### Check 1: Full Title SERP Audit

For each proposal (A, B, C):

1. Extract the `title` from the ANGLE_PROPOSAL file
2. Locate the pre-fetched results for this exact title from the data above
3. Take the top 10 results
4. Classify each result by genre:
   - `brand-documentary` — long-form brand/company narrative (rise/fall/strategy)
   - `news` — current events, breaking news, news commentary
   - `review` — product reviews, comparisons, unboxings
   - `tutorial` — how-to, educational, instructional
   - `entertainment` — vlogs, comedy, lifestyle, reaction
   - `other` — anything that doesn't fit the above
5. Compare against the proposal's `target_ecosystem`
6. Score:
   - **7+ results from target ecosystem → PASS** (strong ecosystem fit)
   - **5-6 results from target ecosystem → AMBER** (flag for human review)
   - **<5 results from target ecosystem → FAIL** (title routes to wrong ecosystem)

### Check 2: Autocomplete Ecosystem Test

For each proposal (A, B, C):

1. Extract the first 3-5 words of the `title`
2. Locate the pre-fetched partial-query results for this prefix from the data above
3. Examine the top 10 result titles — these reveal what YouTube associates with those keywords
4. Record the dominant themes/topics in the suggestions
5. Flag if suggestions point to a competing ecosystem:
   - Example: "Why German Engineering" → results dominated by "German Engineering cars", "German engineering Mercedes", "German engineering BMW" = **automotive ecosystem flag**
   - Example: "The Rise and Fall" → results dominated by "Rise and Fall of [Company]" = **brand-documentary ecosystem match**
6. Classify autocomplete signal as: `aligned`, `mixed`, or `misaligned`

## OUTPUT
### `SERP_AUDIT.yaml`
```yaml
audit_date: "[YYYY-MM-DD]"
proposals_checked: 3

proposal_a:
  title: "[exact title from proposal]"
  target_ecosystem: "[from proposal]"
  serp_check:
    query: "[exact title searched]"
    results:
      - title: "[result title]"
        channel: "[channel name]"
        genre: "brand-documentary|news|review|tutorial|entertainment|other"
      # ... (10 results)
    genre_breakdown:
      brand-documentary: 0
      news: 0
      review: 0
      tutorial: 0
      entertainment: 0
      other: 0
    target_match_count: 0
    verdict: "PASS|AMBER|FAIL"
  autocomplete_check:
    partial_query: "[first 3-5 words]"
    dominant_themes:
      - "[theme 1]"
      - "[theme 2]"
    ecosystem_flags:
      - "[flagged term pointing to wrong ecosystem]"
    signal: "aligned|mixed|misaligned"
  overall_verdict: "PASS|AMBER|FAIL"

proposal_b:
  # ... (same structure)

proposal_c:
  # ... (same structure)

summary:
  all_pass: true|false
  failures: ["A"|"B"|"C"]
  amber_flags: ["A"|"B"|"C"]
  recommendation: "[e.g., 'Proposal A title needs reworking — routes to automotive ecosystem']"
```

## HARD CONSTRAINTS
- MUST analyze the pre-fetched YouTube search data provided above, not hypothetical results
- MUST check ALL 3 proposals — no skipping
- MUST run BOTH checks (full title SERP + autocomplete) for each proposal
- Genre classification must be honest — don't force-fit results into the target ecosystem
- If a proposal FAILS, include a specific note on which keywords are causing the mismatch

## COMPLETION RULE
Done when: SERP_AUDIT.yaml written with real search data for all 3 proposals, both checks completed, verdicts assigned.

## NEXT STEP
`SERP_AUDIT.yaml` + `ANGLE_PROPOSAL_A/B/C.yaml` → `steps/2_human_convergence.md`
