# CROSS-NICHE THUMBNAIL SCAN (Pre-Step for Thumbnail Generation)

## PURPOSE

Find visual patterns that WORK in other YouTube niches but are NOVEL in the target ecosystem. The best thumbnails steal proven patterns from unrelated niches — Sony's thumbnail (disintegrating logo) was stolen from Marvel Studios entertainment videos. It was novel in business docs, proven in entertainment. This step systematizes that theft.

---

## INPUTS

| Input | Source |
|-------|--------|
| `COMPETITOR_SCAN.yaml` | Competitor scan (identifies target ecosystem) |
| `STEP1_promise.yaml` | Core promise (identifies subject/tension) |

---

## STEP 1: Identify Target Ecosystem

From COMPETITOR_SCAN.yaml, determine the target ecosystem:
- What niche are the competitors in? (e.g., "brand documentary," "business explainer," "corporate history")
- What thumbnail patterns dominate this ecosystem? (from `thumbnail_patterns.dominant_compositions`)

This is what we're trying to be DIFFERENT from.

---

## STEP 2: Select 5-6 Outside Niches

Pick 5-6 niches that are **completely unrelated** to the target ecosystem but have high-performing thumbnails. Prioritize niches known for aggressive, optimized thumbnails.

**Good outside niches for business/brand documentaries:**
- True crime / mystery
- Science explainer (Veritasium, Mark Rober style)
- Sports / athlete profiles
- Entertainment news / celebrity
- Tech reviews / gadget channels
- Cooking / food competition

**Bad choices (too close):**
- Finance channels (same ecosystem)
- Other business documentary channels (competitors, not cross-niche)

---

## Pre-Fetched Niche Search Results

The following YouTube search results across outside niches have been pre-fetched. Analyze them directly — do NOT attempt to call any tools.

{pre_fetched_data}

## STEP 3: Analyze Each Niche

From the pre-fetched results above, identify 3-5 **breakout** videos per niche (high views relative to channel size).

For each video found:
1. Note the thumbnail composition
2. Identify the **core visual pattern** — strip away the topic-specific content and name the underlying pattern

**Example pattern extraction:**
- Video: MrBeast "I Survived 100 Days in a Circle" → Pattern: **CONFINEMENT** (person trapped in defined space, overhead shot)
- Video: Veritasium "The Surprising Secret of Synchronization" → Pattern: **MASS REPETITION** (hundreds of identical objects in formation)
- Video: True crime "The CEO Who Faked His Death" → Pattern: **IDENTITY SPLIT** (same face shown twice in different states)

---

## STEP 4: Novelty Filter

For each pattern found, check: **Has this pattern been used in the target ecosystem?**

- Search for similar thumbnails within the target ecosystem competitors
- If the pattern appears in 0-1 competitor videos → **HIGH NOVELTY** (use this)
- If it appears in 2-3 → **MEDIUM NOVELTY** (usable with twist)
- If it appears in 4+ → **LOW NOVELTY** (skip, already saturated)

---

## STEP 5: Rank and Output

Select 5-8 patterns ranked by: `novelty_in_target × proof_of_performance`

---

## OUTPUT

### `CROSS_NICHE_REFERENCE.yaml`

```yaml
cross_niche_reference:
  target_ecosystem: "[e.g., brand documentary]"
  target_dominant_patterns: ["[what competitors all do]"]
  scan_date: "[YYYY-MM-DD]"

  outside_niches_scanned:
    - niche: "[e.g., true crime]"
      videos_analyzed: 4
      example_breakouts:
        - title: "[video title]"
          channel: "[channel]"
          views: "[X]M"
          breakout_ratio: "[X.X]"
          thumbnail_pattern: "[pattern name]"

    - niche: "[e.g., science explainer]"
      videos_analyzed: 3
      example_breakouts:
        - title: "[video title]"
          channel: "[channel]"
          views: "[X]M"
          breakout_ratio: "[X.X]"
          thumbnail_pattern: "[pattern name]"

  cross_niche_patterns:
    - rank: 1
      pattern_name: "[e.g., BRAND DESTRUCTION]"
      description: "[Recognizable brand element visibly breaking/dissolving/crumbling]"
      source_niche: "[entertainment]"
      source_examples:
        - "[Marvel Studios Infinity War trailer — Avengers logo turning to dust]"
      proof_of_performance: "[avg breakout ratio of source videos]"
      novelty_in_target: "HIGH"
      why_it_transfers: "[1 sentence — why this would work in target ecosystem]"
      application_hint: "[How to adapt: replace Marvel logo with target brand logo]"

    - rank: 2
      pattern_name: "[e.g., SCALE SHOCK]"
      description: "[Familiar object rendered impossibly large or small]"
      source_niche: "[science explainer]"
      source_examples:
        - "[Kurzgesagt — Earth next to black hole comparison]"
      proof_of_performance: "[avg breakout ratio]"
      novelty_in_target: "HIGH"
      why_it_transfers: "[1 sentence]"
      application_hint: "[How to adapt]"

    # ... 5-8 total patterns
```

---

## HARD CONSTRAINTS

- Minimum 5 outside niches scanned
- Minimum 3 videos per niche
- Every pattern must have at least ONE real video as proof
- Novelty assessment must be based on actual competitor thumbnails, not assumptions
- Output must include `application_hint` — how to adapt the pattern for the target ecosystem

## COMPLETION RULE

Done when: `CROSS_NICHE_REFERENCE.yaml` contains 5-8 ranked cross-niche patterns with real video evidence and novelty scores.

## NEXT STEP

`CROSS_NICHE_REFERENCE.yaml` → `steps/thumbnail_generation.md`
