<!-- DEPRECATED: This prompt was replaced by the title-first architecture. See angle_generation phase. -->

# COMPETITOR SCAN (Step 1 of YouTube Module)

## PURPOSE

Research YouTube landscape for the topic to identify **breakout videos** (high views relative to subscriber count) and extract patterns that inform title/thumbnail generation.

---

## INPUTS

| Input | Source |
|-------|--------|
| `topic_name` | User |
| `angle_summary` | phase_3B_angle_decision.md |
| `video_class` | phase_3B_angle_decision.md |

---

## STEPS

### Step 1: YouTube Search

Search for 7-10 videos on the topic. Prioritize:

1. **Breakout videos** — High view count relative to channel subscriber count
2. **Recent performers** — Uploaded in last 6 months with strong traction
3. **Evergreen hits** — Older videos still accumulating views
4. **Similar angles** — Videos addressing comparable beliefs or tensions

### Step 2: Breakout Analysis

**CRITICAL:** Calculate views-to-subscriber ratio for each video.

**Formula:** `views ÷ channel_subscribers = breakout_ratio`

| Ratio | Classification |
|-------|----------------|
| > 2.0 | **Strong breakout** — Title/thumbnail working hard |
| 1.0 - 2.0 | **Solid performer** — Good packaging |
| 0.5 - 1.0 | **Average** — Typical for channel |
| < 0.5 | **Underperformer** — Packaging may be weak |

**Breakout Videos Table:**

| Title | Channel | Subs | Views | Ratio | Formula | Why It Broke Out |
|-------|---------|------|-------|-------|---------|------------------|
| | | | | | | |

Focus analysis on videos with ratio > 1.0. These are the titles worth studying.

### Step 3: Pattern Extraction

**Title Patterns (from breakouts only)**

| Video | Title | Formula | Key Elements | Tension Type |
|-------|-------|---------|--------------|--------------|
| | | | [number/noun/verb] | [expectation violated / status reversal / etc.] |

**Thumbnail Patterns (from breakouts only)**

| Video | Composition | Text | Face/Logo | Colors | Why It Works |
|-------|-------------|------|-----------|--------|--------------|
| | [SYMBOL/CONTRAST/DATA/FACE] | | | | |

### Step 4: Synthesis

**Patterns to Mirror** (top 2-3 from breakouts)

1. **[Formula name]:** [Template + example from breakout]
   - Why it works: [insight]

2. **[Formula name]:** [Template + example from breakout]
   - Why it works: [insight]

**Patterns to Avoid** (overused or underperforming)

- [Pattern] — [why saturated or weak]
- [Pattern] — [why saturated or weak]

**Gaps Identified** (angles competitors missed)

- [Gap 1] — [opportunity]
- [Gap 2] — [opportunity]

**Visual Hooks Available** (from our content)

Top 3 compelling visual elements we can use:

1. [Hook] — [why compelling]
2. [Hook] — [why compelling]
3. [Hook] — [why compelling]

---

## OUTPUT

`_COMPETITOR_SCAN.yaml` (intermediate, internal)

```yaml
competitor_scan:
  topic: "[topic]"
  date: "[date]"
  search_terms_used:
    - "[term 1]"
    - "[term 2]"

  breakout_videos:
    - title: "[title]"
      channel: "[channel name]"
      subscribers: "[X]K or [X]M"
      views: "[X]M"
      breakout_ratio: [X.X]
      upload_date: "[YYYY-MM-DD]"
      title_formula: "[formula name]"
      title_elements:
        number: "[if present]"
        proper_noun: "[if present]"
        concrete_verb: "[if present]"
        tension_type: "[expectation violated / status reversal / insider admission / etc.]"
      thumbnail_style: "[SYMBOL / CONTRAST / DATA / FACE]"
      thumbnail_text: "[overlay text if any]"
      insight: "[why this broke out]"

  all_videos_analyzed:
    - title: "[title]"
      views: "[X]M"
      ratio: [X.X]
      classification: "[strong breakout / solid / average / underperformer]"

  patterns_to_mirror:
    - formula: "[formula name]"
      template: "[e.g., 'Why [Giant] Can't [Basic Thing]']"
      example: "[actual breakout title]"
      breakout_ratio: [X.X]
      why_it_works: "[insight]"

    - formula: "[formula name]"
      template: "[template]"
      example: "[actual breakout title]"
      breakout_ratio: [X.X]
      why_it_works: "[insight]"

  patterns_to_avoid:
    - pattern: "[pattern]"
      reason: "[oversaturated / underperforming / etc.]"
      examples_seen: [N]

  gaps_identified:
    - gap: "[unexplored angle]"
      opportunity: "[why this could work]"

  thumbnail_patterns:
    dominant_compositions: ["SYMBOL", "CONTRAST", etc.]
    text_patterns: ["short imperative", "question", "number callout", etc.]
    color_schemes: ["red/black", "blue/white", etc.]
    face_usage: "[common / rare / only T1 faces]"

  visual_hooks_available:
    - hook: "[element from our content]"
      why: "[reason it's compelling]"
    - hook: "[element]"
      why: "[reason]"
    - hook: "[element]"
      why: "[reason]"
```

---

## EXECUTION OPTIONS

### YouTube Search (Required)

**Use the YouTube MCP `search_videos` tool** — NOT web search with `site:youtube.com`.

```
search_videos(query="[topic keywords]", max_results=10)
```

This returns:
- Video titles, channel names, view counts
- Duration, publish date
- Thumbnails

**DO NOT** append "youtube" to a web search query. The YouTube MCP has direct API access and returns structured data.

### Getting Subscriber Counts

To calculate breakout ratio, you need subscriber counts. Options:

1. **YouTube MCP `get_video_info`** — Get channel info from video
2. **Social Blade lookup** — `web_fetch` socialblade.com/youtube/channel/[id]
3. **Estimate from channel page** — Less accurate but faster

If exact subscriber count unavailable, estimate from channel size indicators and note as approximate.

---

## NOTE

This is an internal step. The output feeds directly into `title_generation.md` Step 1 (Review Competitive Intelligence).

The breakout analysis is **critical** — it determines which title formulas get mirrored in Angle 10 of title generation.

Consumer sees only the final `YOUTUBE_PACKAGE.yaml`.
