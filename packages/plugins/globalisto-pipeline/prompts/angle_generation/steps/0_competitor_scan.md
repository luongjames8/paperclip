# STEP 0: COMPETITOR SCAN

## PURPOSE
Scan YouTube for existing coverage of this topic. Identify what angles have been taken, what's saturated, and where the gaps are. This feeds into angle generation so agents know what to avoid.

## INPUT
| Input | Source |
|-------|--------|
| `DISCOVERY_COMPLETE.yaml` | From Discovery phase |

## Pre-Fetched YouTube Results

The following YouTube search results for this topic have been pre-fetched. Analyze them directly — do NOT attempt to call any tools.

{pre_fetched_data}

## PROCESS

1. Extract the topic/subject from DISCOVERY_COMPLETE.yaml
2. From the pre-fetched results above, identify 10-15 top videos on this topic
3. For each video, note:
   - Title and channel
   - View count and age
   - Angle taken (what promise does the title make?)
   - Thumbnail approach
   - **Format classification**: news clip (<5min), explainer (5-15min), documentary (15-30min), interview, corporate promo
4. Classify the competitive landscape at TWO levels:

   **TOPIC-level saturation** — Has this topic been covered at all?
   - **Saturated topics**: Topic covered by 3+ videos (BUT may still have format gaps)
   - **Underserved topics**: Topic with 0-1 videos total

   **FORMAT-level saturation** — Has this topic been covered AS A DOCUMENTARY?
   - **Format gap**: Topic has news clips and explainers but ZERO 15-20 min documentaries (THIS IS THE REAL OPPORTUNITY)
   - **Format saturated**: Topic has 2+ documentaries from channels with 100K+ subs (harder to differentiate)

   A topic can be TOPIC-saturated but FORMAT-unsaturated. Example: "Antimony China ban" has 6 news clips but ZERO documentaries. That's a format gap, not a saturated angle.

   **The PRIMARY opportunity is always a format gap on a topic with proven demand (existing news coverage = demand signal).**

5. Identify:
   - **Format gaps**: Topics with views/demand but no documentary treatment (HIGHEST PRIORITY)
   - **Underserved angles**: Genuinely novel sub-topics with 0-1 videos (SECONDARY — only if they pass the CNN chyron test)
   - **High-performing outliers**: Videos with unusually high views (STUDY these)

6. **CRITICAL: Identify the CORE STORY**
   After scanning all videos, answer this question:
   > "If a normal person heard about this topic for the first time, what would they find most alarming/interesting?"
   
   That answer is the core story. It may NOT be the most "novel" finding from discovery. It's the thing a CNN chyron would say. Document this explicitly in the output as `core_story`.

## OUTPUT
### `COMPETITOR_SCAN.yaml`
```yaml
topic: "[subject from discovery]"
scan_date: "[YYYY-MM-DD]"
videos_analyzed: 10

core_story: "[The CNN chyron — the simplest, most alarming truth about this topic that a normal person would react to. This is NOT necessarily the most novel finding from discovery. It's the headline.]"

format_gaps:
  - topic: "[topic area with demand]"
    existing_coverage: "[news clips / explainers that prove demand exists]"
    existing_views: "[total views across existing coverage]"
    documentary_count: 0
    opportunity: "[why a documentary treatment would work]"

saturated_angles:
  - angle: "[description]"
    video_count: 3
    format: "[news clip / explainer / documentary]"
    example_titles:
      - "[title 1]"
      - "[title 2]"

underserved_angles:
  - angle: "[description]"
    evidence: "[why this is underserved]"
    passes_cnn_chyron_test: true/false
    note: "[if false: this is a research detail, not a headline — use as supporting content only]"

high_performers:
  - title: "[video title]"
    channel: "[channel name]"
    views: 1000000
    format: "[news clip / explainer / documentary]"
    angle: "[what made this work]"

ecosystem_channels:
  - name: "[channel name]"
    subscriber_range: "[rough range]"
    relevance: "[why relevant]"
```

## HARD CONSTRAINTS
- MUST use actual YouTube search data, not hypothetical results
- Minimum 10 videos analyzed
- MUST identify at least 1 saturated angle and 1 underserved angle

## COMPLETION RULE
Done when: COMPETITOR_SCAN.yaml written with real search data, saturated and underserved angles identified.

## NEXT STEP
`COMPETITOR_SCAN.yaml` → `steps/1_agent_proposals.md`
