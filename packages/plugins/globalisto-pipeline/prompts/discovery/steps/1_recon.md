# 1: MULTI-PLATFORM RECON

## SINGLE CONCERN

Discover where a topic is being discussed and what themes emerge across platforms.

**This replaces top-down guessing (1a, 1b).** Instead of predicting beliefs, we scan the discourse landscape to find what's actually being discussed.

---

## PURPOSE

```
BEFORE (v1): Claude guesses beliefs → searches for confirmation → confirmation bias
AFTER (v2):  Search broadly → observe themes → ground queries in reality
```

---

## INPUT

| Input | Source |
|-------|--------|
| `topic` | The topic area to explore |
| `audience_context` | Who might hold beliefs about this topic |

---

## OUTPUT

```yaml
themes:
  - id: T_01
    name: "Lifetime employment is dying"
    description: "Discussions about younger Japanese workers abandoning traditional job security"
    source_platforms: [reddit, youtube, news]
    heat_score: 85
    sample_quotes:
      - "I'm 28 and this is my fourth company"
      - "Nobody under 35 expects lifetime employment anymore"
    search_queries_used:
      - "Japanese work culture site:reddit.com"
      - "job hopping Japan millennials"

  - id: T_02
    name: "Performative overtime culture"
    description: "Workers staying late for appearance, not productivity"
    source_platforms: [reddit, quora]
    heat_score: 72
    sample_quotes:
      - "Half my overtime is theater"
      - "Leave when the boss leaves is still a thing"
    search_queries_used:
      - "Japanese overtime site:reddit.com"

platform_heat_map:
  - platform: reddit
    heat_score: 90
    sample_count: 45
  - platform: youtube
    heat_score: 65
    sample_count: 23
  - platform: news
    heat_score: 50
    sample_count: 18
  - platform: quora
    heat_score: 40
    sample_count: 12

search_log:
  - query: "Japanese work culture site:reddit.com"
    results_count: 15
    platform: reddit
  - query: "working in Japan vlog"
    results_count: 8
    platform: youtube
```

---

## Pre-Fetched Search Results

The following search results have been pre-fetched for the topic's key themes. Analyze them directly — do NOT attempt to call any tools.

{pre_fetched_data}

## PROCESS

### 1. Generate recon queries (30-50 total)

Generate broad queries across multiple platforms:

| Platform | Query Count | Query Types |
|----------|-------------|-------------|
| Reddit | 8-12 | `[topic] site:reddit.com`, `[topic] unpopular opinion site:reddit.com` |
| YouTube | 5-8 | `[topic]`, `[topic] explained`, `[topic] documentary` |
| News | 5-8 | `[topic] 2024`, `[topic] Japan Times OR Nikkei` |
| Twitter/X | 3-5 | `[topic] site:twitter.com` |
| Forums | 3-5 | `[topic] forum`, `[topic] discussion` |
| General | 5-8 | `[topic]`, `[topic] controversy`, `[topic] wrong` |
| **Historical** | 5-8 | `[topic] history origin`, `[topic] how it started`, `[topic] timeline` |

**NOTE:** The pre-fetched results above contain data across these platform types. Use them as your primary source for theme extraction. Do not attempt to call any search tools.

#### TEMPORAL DEPTH REQUIREMENT (youtube_video and youtube_video_thematic content types)

**For video content, recon MUST NOT only search for what's being discussed NOW.**

Current discourse is biased toward the latest crisis/controversy. A YouTube documentary needs CONTEXT — the viewer needs to understand how we got here, not just what's happening today.

**Step 1: Classify the topic type:**

| Topic Type | Example | Historical queries needed? |
|-----------|---------|--------------------------|
| **Company/Brand** | Samsung, Boeing, Yahoo | YES — founding, key milestones, competitive history |
| **Person** | Elon Musk, Lee Kun-hee | YES — career arc, key decisions, turning points |
| **System/Policy** | FDA drug inspection, layoff culture | PARTIAL — when did the system start? What was it designed for? |
| **Event/Crisis** | Antimony supply, Iran war | PARTIAL — what was the status quo before the event? |
| **Concept** | Tang ping, effort culture | MINIMAL — when did the concept emerge? What preceded it? |

**Step 2: Add context queries based on topic type.**

For Company/Brand topics, add 8-12 queries covering:
- `[company] origin story founding history`
- `[company] early products first success`
- `[company] vs [known competitor] history` (identify competitors from initial search results)
- `[company] strategy how they became successful`
- `[company] peak dominance biggest achievement`

For System/Policy topics, add 3-5 queries covering:
- `[system] origin history why it was created`
- `[system] how it used to work before`

For all video topics, add 2-3 aftermath queries:
- `[topic] recovery future outlook`
- `[topic] what happens next`

**Step 3: Check temporal spread after theme extraction.**

Tag each theme with a rough time period:
```yaml
themes:
  - id: T_01
    name: "Samsung copied Sony TVs"
    time_period: "1970s-1980s"
    ...
  - id: T_02
    name: "HBM chip crisis"
    time_period: "2024-present"
    ...
```

**FAILURE CHECK:** If ALL themes fall within a 3-year window → the recon has found only the CURRENT moment, not the story. Add historical queries and re-extract before proceeding. A documentary that only covers the last 3 years is a news explainer, not a documentary.

**WHY THIS MATTERS:** A viewer who clicks "Samsung Copied For 50 Years" expects to see Samsung copying Sony, Motorola, and Apple over decades — not just a deep-dive into HBM chip packaging processes from 2024. The history is what makes the crisis meaningful.

#### Query patterns for finding discourse

```
[topic]                          # Baseline
[topic] controversy              # Contentious aspects
[topic] wrong                    # Counter-narratives
[topic] actually                 # Corrections and pushback
[topic] unpopular opinion        # Minority views
[topic] myth                     # Challenged assumptions
why [topic]                      # Explanations and theories
[topic] experience               # First-person accounts
[topic] history origin founding  # Historical arc (video content)
[topic] how it started rise      # Rise arc (video content)
[topic] copying [competitor]     # Competitive history (video content)
```

### 2. Analyze pre-fetched results

From the pre-fetched results above:
- Extract: titles, snippets, URLs
- Note: DO NOT fetch URLs yet (that's Phase 3)

### 3. Extract themes (5-15)

Cluster search results into themes:

1. **Read snippets** - Look for recurring ideas across results
2. **Group similar ideas** - Cluster snippets expressing the same concept
3. **Name the theme** - 3-8 word label
4. **Describe it** - 1-2 sentence explanation
5. **Track sources** - Which platforms surfaced this theme
6. **Pull sample quotes** - 2-3 representative excerpts from snippets

#### Theme requirements

- Each theme must have 3+ supporting snippets
- Themes must be distinct (not overlapping)
- Include both majority AND minority views
- Include counter-narratives if found

#### TEMPORAL SPREAD CHECK (youtube_video and youtube_video_thematic)

After extracting themes, verify temporal spread by checking the `time_period` tags.

**If ALL themes fall within a 3-year window:** STOP. Add historical/contextual queries and re-extract.

**If themes span 10+ years:** Good. The recon has found a story, not just a news cycle.

**If themes span 3-10 years:** Acceptable for event/concept topics. Flag for review if it's a company/brand topic (those usually need more history).

### 4. Build platform heat map

Count results per platform:

```
heat_score = (results_count / max_platform_count) * 100
```

Normalize to 0-100 scale based on highest-count platform.

---

## CONSTRAINTS

| Rule | Reason |
|------|--------|
| Do NOT extract beliefs yet | That's Phase 4 (2c) |
| Do NOT fetch URLs yet | That's Phase 3 (2b) |
| Do NOT classify or judge | Just observe and cluster |
| Themes must be grounded | Every theme needs snippet evidence |
| Include counter-narratives | Don't filter out minority views |

---

## QUANTITY TARGETS

| Output | Minimum | Maximum |
|--------|---------|---------|
| Searches | 30 | 50 |
| Themes | 5 | 15 |
| Platforms with results | 3 | - |
| Sample quotes per theme | 2 | 5 |

---

## HARD CONSTRAINTS

- Generate themes ONLY from search snippets (not from prior knowledge)
- Each theme must cite specific snippets as evidence
- Do not fetch any URLs (just collect them for later)
- Do not skip any major platform (Reddit, YouTube, news must all be searched)
- Heat scores must be calculated from actual result counts

---

## COMPLETION RULE

Done when:
- 30+ searches executed across 4+ platforms
- 5+ distinct themes identified
- Each theme has 3+ supporting snippets
- Platform heat map calculated
- Search log complete

---

## NEXT STEP

`themes[]`, `platform_heat_map` → `steps/2a_generate_queries.md`
