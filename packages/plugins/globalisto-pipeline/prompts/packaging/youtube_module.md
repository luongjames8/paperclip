# YOUTUBE MODULE

## MODEL SELECTION

| Step | Model | Rationale |
|------|-------|-----------|
| 1. Competitor Scan | DeepSeek | Has web_search tool, breakout analysis |
| 1.5. Core Promise Extraction | Opus | Editorial judgment on primary subject |
| 2. Title Generation (all 20) | Opus | Creative generation requires quality |
| 2. Title Scoring | Opus | Judgment requires nuance |
| 2. Recognition Check | DeepSeek | Simple tier lookup |
| 3. Shorts Extraction | Opus | Strategic alignment |
| 4. Midroll Placement | DeepSeek | Mechanical positions |
| 5. Description | Opus | Better hooks |
| 6. Production Tags | DeepSeek | Mechanical transformation |
| 7. Editor Resources | DeepSeek | Table assembly |

**Principle:** DeepSeek is for mechanical/lookup tasks. Opus handles all creative generation and nuanced judgment.

---

## PURPOSE

Generate YouTube title-thumbnail packages that accurately represent video content. All packaging variations express the **core promise**—not tangential angles.

This is the consumer-facing entry point. It orchestrates nine internal steps.

---

## THE CORE CONSTRAINT

**"Would a reasonable viewer feel misled if this title led them to the video?"**

This is the only hard alignment gate. Everything else informs scoring.

Every title and thumbnail must:
- Express the core promise (extracted in Step 1.5)
- Feature the PRIMARY subject, not secondary elements
- Deliver on what viewers expect when they click

---

## INPUTS

| Input | Source | Purpose |
|-------|--------|---------|
| `topic_name` | User | Topic identifier |
| `angle_summary` | phase_3B_angle_decision.md | Core angle and why it was selected |
| `video_class` | phase_3B_angle_decision.md | `detonator` or `mirror` |
| `NARRATIVE_BLUEPRINT.md` | phase_5 | Section structure for video overview |
| `POLISHED_SCRIPT.md` | phase_10 | Runtime calculation and key moments |

---

## OUTPUTS

| Output | Content |
|--------|---------|
| `YOUTUBE_PACKAGE.yaml` | Core promise, titles, thumbnails, pairings |
| `SHORTS_PACKAGE.md` | 4 shorts + release schedule |
| `PRODUCTION_SCRIPT.md` | Polished script with production tags |
| `EDITOR_RESOURCES.md` | Resource table with HTTP links |

### YOUTUBE_PACKAGE.yaml

```yaml
YOUTUBE_PACKAGE:
  topic: "[topic_name]"
  video_class: "[detonator|mirror]"
  generated: "[date]"

  core_promise:
    video_type: "[single-focus | comparative | thematic | mystery]"
    one_sentence: "[what this video delivers — ≤30 words]"
    viewer_transformation: "[what viewer understands after watching]"
    primary_subject: "[specific main person/company/concept]"
    secondary_elements:
      - element: "[name]"
        role: "[counterexample | modern example | historical context]"
    question_answered: "[the question this video answers — ends with ?]"
    core_tension: "[Subject] is expected to [X], but actually [Y]"
    validation_status: "[PASSED | PASSED_WITH_AUTO_FIX | ESCALATED]"
    section_analysis:
      total_sections: [N]
      primary_subject_sections: [N]
      coverage_percentage: [N%]

  competitor_insights:
    breakout_videos:
      - title: "[title]"
        channel: "[channel]"
        views_to_subs: [ratio]
        formula: "[pattern]"
        insight: "[why it worked]"
    patterns_to_mirror:
      - "[formula 1]"
      - "[formula 2]"
    patterns_to_avoid:
      - "[oversaturated pattern]"
    gaps_identified:
      - "[unexplored angle]"
    thumbnail_patterns:
      dominant_compositions: []
      text_patterns: []
      color_schemes: []
    visual_hooks_available:
      - hook: "[element from our content]"
        why: "[reason it's compelling]"

  packages:
    - rank: "primary"
      title:
        text: "[title]"
        angle: "[which of 10 angles]"
        score: [X%]
        tension_score: "[strong/moderate/weak]"
        specificity_elements:
          number: "[e.g., 23%]"
          proper_noun: "[e.g., BMW, Tesla]"
          concrete_verb: "[e.g., burns]"
        recognition_tier: "[T1/T2/mixed]"
      thumbnail:
        composition_type: "[SYMBOL | CONTRAST | DATA | FACE]"
        visual: "[description — designed FOR this title]"
        text_overlay: "[≤4 words that ADD to title]"
        colors: "[color scheme]"
        complements_title: "[how thumbnail adds context title doesn't say]"
        score: [X%]
      rationale: "[why title + thumbnail work as a unit]"

    - rank: "variant"
      # same structure

    - rank: "alternative"
      # same structure

  video_overview:
    runtime: "[X:XX]"
    sections:
      - id: "S1"
        name: "[section name]"
        time: "[0:00-X:XX]"
    key_moments:
      hook: "[opening line or moment]"
      turn: "[pivot moment]"
      climax: "[strongest reveal]"

  midroll_positions:
    video_runtime: "[X:XX]"
    recommended_count: [N]
    positions:
      - position: 1
        timecode: "[X:XX]"
        section_context: "[end of X / start of Y]"
        placement_type: "[section_transition|tension_valley|topic_shift]"
        confidence: "[high|medium]"
        rationale: "[why this works]"

  description:
    hook_line: "[first 100-150 chars visible in search]"
    full_text: |
      [Complete description with chapters, CTAs, links, hashtags]
    seo_notes:
      primary_keyword: "[main keyword]"
      secondary_keywords: []
      hashtags: []

  generation_log:
    initial_titles_generated: 20
    angles_explored: 10
    breakout_formulas_mirrored: 2
    titles_scored: 20
    alignment_flags: [N]
    top_5_scores: "[X% - Y%]"
    winning_angle:
      title: "[winning title]"
      core_frame: "[insight]"
      key_tension: "[expectation vs reality]"
    variations_generated: 4
    final_pool_size: 9
    final_titles_selected: 3
    score_spread: "[X% - Y%]"
    thumbnails_generated: 15
    thumbnails_selected: 3
    packages_output: 3
```

---

## EXECUTION

This module runs in nine steps:

### Step 1: Competitor Scan
**Prompt:** `steps/competitor_scan.md`

Research YouTube landscape for the topic. Identify **breakout videos** (high views:subscriber ratio) and extract winning patterns.

**Key outputs:**
- Breakout videos with ratios (> 1.0 = worth studying)
- Patterns to mirror (top 2-3 formulas from breakouts)
- Patterns to avoid (oversaturated)
- Gaps identified (unexplored angles)

**Intermediate output:** `_COMPETITOR_SCAN.yaml` (internal, feeds into Step 2)

### Step 1.5: Core Promise Extraction
**Prompt:** `steps/core_promise_extraction.md`

Extract the core promise of the video BEFORE title generation using section-based measurement.

**Reads:** `NARRATIVE_BLUEPRINT.md`, `POLISHED_SCRIPT.md`
**Intermediate output:** `core_promise` object (feeds into Step 2)

**Method:**
1. Count sections in NARRATIVE_BLUEPRINT
2. Identify primary entity per section (by mention frequency)
3. Apply classification rules (≥80% = single-focus, etc.)
4. Validate with structural and content checks
5. Auto-fix minor issues, escalate blockers

**Outputs:**
- Video type: single-focus, comparative, thematic, or mystery
- Primary subject: specific entity (not generic)
- Secondary elements: supporting elements that should NOT drive titles
- One-sentence promise: ≤30 words, mentions primary subject
- Core tension: expectation vs reality (if present)
- Validation status: PASSED, PASSED_WITH_AUTO_FIX, or ESCALATED

**Gate:** If validation_status = ESCALATED, do NOT proceed to Step 2

### Step 2: Title Generation
**Prompt:** `steps/title_generation.md`

Generate a wide field of title candidates across multiple angles, pass through alignment/recognition/promise gates, generate variations, and organize into frame groups.

**Reads:** `core_promise`, `_COMPETITOR_SCAN.yaml`
**Output:** `STEP3_title_groups.yaml` with title groups organized by frame

### Step 2b: Thumbnail Generation
**Prompt:** `steps/thumbnail_generation.md`

Generate thumbnail concepts for each title group. Each group gets one thumbnail that works for all its titles. Uses competitive intelligence from competitor scan.

**Reads:** `STEP3_title_groups.yaml`, `STEP1_promise.yaml`, `STEP2_competitors.yaml`
**Output:** `YOUTUBE_PACKAGE.yaml` with title groups + thumbnails merged

**Flow:**
1. Review competitive intelligence (breakout patterns, gaps)
2. **Generate 20 titles across 10 angles** (2 per angle):
   - Core Promise, Tension/Surprise, Personal Stakes, Villain
   - Mechanism, Comparison, Origin/Attribution, Consequence
   - Curiosity Gap, Breakout Mirror
3. **Score all 20 titles** (no hard gates except "would viewer be misled?")
4. Identify winning angle from top scorer
5. Generate 4 variations of winning angle
6. Score variations
7. Select top 3 from pool of 9 (top 5 + 4 variations)
8. For EACH top 3: generate 5 thumbnail concepts
9. Score thumbnails → pick ONE per title
10. Output as packages

**Scoring Factors:**
| Factor | Weight |
|--------|--------|
| Tension | 25% |
| Specificity | 20% |
| Recognition | 20% |
| Personal Stakes | 15% |
| Curiosity Gap | 10% |
| Breakout Match | 10% |

**Key principle:** Wide then narrow. Generate 20 across 10 angles, converge on winning frame, then vary that frame.

**Recognition Tiers:**
- Tier 1 (Universal): Tesla, Musk, Apple, China — score highest
- Tier 2 (Category): BMW, VW, Porsche — good for topic content
- Tier 3 (Insider): Oliver Blume, CARIAD — needs upgrade to score well

**Thumbnail Scoring:**
| Factor | Weight |
|--------|--------|
| Complements title | 30% |
| Recognition | 25% |
| Visual impact | 25% |
| Text value | 20% |

### Step 3: Shorts Extraction
**Prompt:** `steps/shorts_extraction.md`

Extract 4 YouTube Shorts (HOOK, STAT, VILLAIN, TWIST) from the polished script.

**Output:** `SHORTS_PACKAGE.md`

### Step 4: Midroll Placement
**Prompt:** `steps/midroll_placement.md`

Identify optimal midroll ad positions based on narrative structure and pacing.

**Output:** Appends `midroll_positions` to `YOUTUBE_PACKAGE.yaml`

### Step 5: Description Generation
**Prompt:** `steps/description_generation.md`

Generate SEO-optimized description with chapters, CTAs, and hashtags.

**Output:** Appends `description` to `YOUTUBE_PACKAGE.yaml`

### Step 6: Production Tags Transform
**Prompt:** `steps/production_tags_transform.md`

Transform data point and quote citations into screen-ready production tags for editors.

**Input:** `POLISHED_SCRIPT.md`, `research_master.yaml`
**Output:** `PRODUCTION_SCRIPT.md` (script with production tags inserted)

### Step 7: Editor Resources Assembly
**Prompt:** `steps/editor_resources_assembly.md`

Generate a self-contained resource table with HTTP links so editors never need to open the YAML.

**Input:** `PRODUCTION_SCRIPT.md`, `research_master.yaml`
**Output:** `EDITOR_RESOURCES.md` (appended to master file)

### Step 8: Word Count
**Script:** `scripts/count_script_words.js`

Count narrator words in the production script for pay-by-word billing.

**Input:** `PRODUCTION_SCRIPT.md`
**Output:** Console output with per-section and total word counts

---

## PRINCIPLES

1. **Wide then narrow** — Generate 20 titles across 10 angles, then converge
2. **Core constraint is sacred** — Viewer must not feel misled (only hard gate)
3. **Scoring over gating** — Everything else informs ranking, doesn't block
4. **Tension matters most** — 25% weight, highest factor
5. **Competitive intel drives angles** — Breakout patterns inform generation
6. **Title + thumbnail are a unit** — Design together, evaluate together
7. **Primary subject only** — Secondary elements support but don't drive titles
8. **Video class informs emotion:**
   - detonator = revelation, shock, "you won't believe"
   - mirror = tension, reflection, "uncomfortable truth"

---

## ANTI-PATTERNS (What NOT to Do)

| Bad Pattern | Example | Why It Fails |
|-------------|---------|--------------|
| Promoting secondary element | "The Lincoln Electric Secret" when video is about Jack Welch | Viewers expect Lincoln, get Welch |
| Tangential angle | "Why Every CEO Uses the Same Script" for video about layoff origins | Doesn't match content |
| Clickbait disconnect | Shocking thumbnail of person who appears for 30 seconds | Promise ≠ delivery |
| Formula over substance | Forcing a pattern that doesn't fit | Accuracy > cleverness |
| All vague titles | "German Engineering Is Dying" × 5 | No specificity, no differentiation |
| Ignoring breakout data | Not using competitor insights | Missing proven patterns |
| Narrow initial generation | Only 5-6 titles from 1-2 angles | Not exploring the space |
