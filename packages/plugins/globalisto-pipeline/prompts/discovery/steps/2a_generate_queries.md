# 2a: GENERATE QUERIES (v2)

## SINGLE CONCERN

Turn discovered themes into targeted search queries for deep-dive extraction.

**v2 Change:** Input is now themes from recon (1_recon), not topic framing.

---

## HOW SEARCH WORKS

Queries go to WebSearch, which returns:
- Markdown-formatted snippets with embedded quotes
- Source URLs for fetching (articles, Wikipedia, government sites)

Queries are weighted by platform heat from recon—hotter platforms get more queries.

---

## INPUT

| Input | Source |
|-------|--------|
| `themes[]` | Themes from 1_recon step |
| `platform_heat_map` | Platform activity levels from recon |
| `iteration` | Loop iteration (1, 2, 3...) |
| `gap_queries` | Optional: targeted queries from gap_check (iteration 2+) |

---

## OUTPUT

```yaml
queries:
  - query: "Japanese job hopping millennials site:reddit.com"
    target_platform: reddit
    theme_id: T_01

  - query: "lifetime employment dead Japan survey"
    target_platform: news
    theme_id: T_01

  - query: "Japanese overtime culture fake site:reddit.com"
    target_platform: reddit
    theme_id: T_02

  - query: "Japan work hours OECD statistics"
    target_platform: academic
    theme_id: T_02

  - query: "foreign workers Japan promotion barriers"
    target_platform: general
    theme_id: T_03
```

---

## PROCESS

### 1. Theme-to-query generation

For each theme, generate 2-3 queries using **topic language** (not discourse language):

```
Theme: "Nokia CEO said we didn't do anything wrong"
  ✗ "Nokia CEO we didn't do anything wrong"     # Discourse language - finds Reddit
  ✓ "Nokia smartphone failure analysis"          # Topic language - finds journalism
  ✓ "Nokia touchscreen prototype 2004"           # Specific facts - finds primary sources
  ✓ "Nokia vs iPhone case study INSEAD"          # Academic framing - finds research

Theme: "Lifetime employment is dying in Japan"
  ✗ "lifetime employment dying Japan"            # Discourse language
  ✓ "Japan job tenure statistics OECD"           # Data language - finds sources
  ✓ "Japanese millennials job hopping survey"    # Research framing
```

**The rule:** If your query contains words from viral quotes or Reddit titles, rewrite it using journalist/researcher language.

### 2. Weight by platform heat

Allocate more queries to hotter platforms:

| Heat Score | Extra Queries |
|------------|---------------|
| 80-100 | +3 queries for this platform |
| 60-79 | +2 queries for this platform |
| 40-59 | +1 query for this platform |
| <40 | Baseline only |

### 3. Ensure diversity sampling

Even if a platform is cold, include minimum queries:

| Platform | Minimum |
|----------|---------|
| Reddit/forums | 2 |
| News/articles | 2 |
| Academic/data | 1 |
| YouTube | 1 |

### 4. Handle gap-check iterations (iteration 2+)

If `gap_queries` provided from gap_check:
- Include all gap queries
- Add 2-3 variants per gap query
- Target gaps specifically, don't repeat successful themes

---

## QUERY COUNT TARGETS

| Iteration | Total Queries | Distribution |
|-----------|---------------|--------------|
| 1 | 20-35 | Weighted by theme count and platform heat |
| 2+ | 8-15 | Focused on gaps identified by gap_check |

### Iteration 1 distribution (example with 6 themes)

```
Per theme: 2-3 queries = 12-18 base queries
Platform bonuses: 5-10 queries
Diversity minimum: 3-5 queries
Total: 20-33 queries
```

---

## QUERY PRINCIPLES

### Use TOPIC language, not DISCOURSE language

**Critical:** Themes contain discourse (what people say). Queries must find sources (journalism, data).

Discourse language = the words people use when discussing (memes, quotes, opinions)
Topic language = the words journalists use when reporting (events, facts, names)

**Transform discourse into topic queries:**

| Theme/Quote (Discourse) | Bad Query | Good Query |
|-------------------------|-----------|------------|
| "Nokia CEO said we didn't do anything wrong" | `Nokia CEO we didn't do anything wrong speech` | `Nokia smartphone failure case study` |
| "Kodak buried the digital camera" | `Kodak buried digital camera` | `Steven Sasson Kodak digital camera 1975` |
| "They listened to customers and died" | `companies died listening customers` | `Kodak disruption Harvard Business Review` |

**Ask:** "What would a journalist's headline be about the underlying EVENTS, not the viral QUOTE?"

### Target verifiable sources

Prioritize queries that will find:
- Direct quotes (for verification)
- Statistics with sources
- Named individuals or organizations
- Dated content

### Avoid

- Generic queries that return listicles
- Queries that return only SEO content
- Queries unlikely to have fetchable results
- **Viral quote language** (finds more discourse, not sources)

### Query syntax

```
# Platform targeting (WebSearch)
[keywords] site:reddit.com
[keywords] site:twitter.com

# YouTube targeting (use YouTube MCP, NOT WebSearch)
# Call: search_videos(query="[keywords]", max_results=10)
# Do NOT use: [keywords] site:youtube.com

# Source targeting
[keywords] Japan Times OR Nikkei Asia
[keywords] site:.go.jp                    # Government sources
[keywords] research study OR survey

# Perspective targeting
[keywords] unpopular opinion
[keywords] actually wrong
[keywords] myth debunked
```

**IMPORTANT:** For YouTube queries, use the `search_videos` MCP tool instead of WebSearch with `site:youtube.com`. The YouTube MCP returns structured video data (titles, views, duration, channel).

---

## HARD CONSTRAINTS

- Generate queries ONLY (do not search yet)
- Every query must link to a theme_id
- Every query must specify target_platform
- Must respect platform minimums
- On iteration 2+, must address gaps
- Do NOT repeat queries from previous iterations

---

## QUERY REFINEMENT GATE (DeepSeek)

**After generating queries, delegate refinement to DeepSeek.** This catches discourse language that would find unfetchable sources.

### Send to DeepSeek (`deepseek chat`):

```
You are refining search queries for a research pipeline.

PROBLEM: Queries using "discourse language" (viral quotes, Reddit phrasing, meme language) find more discourse (Reddit, Medium, Quora) which cannot be verified. We need queries using "topic language" (journalist/researcher phrasing) to find fetchable journalism and academic sources.

DISCOURSE LANGUAGE (bad):
- Uses exact words from viral quotes or Reddit titles
- Sounds like a Reddit post title
- Contains meme phrasing
- Would return social media discussions

TOPIC LANGUAGE (good):
- Uses words a journalist would use in a headline
- Uses words a researcher would use in a paper title
- Names specific people, dates, events
- Would return news articles, case studies, academic papers

EXAMPLES:
| Discourse (kill/upgrade) | Topic (good) |
|--------------------------|--------------|
| "Nokia CEO we didn't do anything wrong" | "Nokia smartphone failure case study" |
| "Kodak buried the digital camera" | "Steven Sasson Kodak digital camera 1975" |
| "companies died listening customers" | "Kodak disruption Harvard Business Review" |
| "lifetime employment dying Japan" | "Japan job tenure statistics OECD" |

QUERIES TO CHECK:
[list all generated queries]

FOR EACH QUERY:
1. Is this discourse language or topic language?
2. If discourse: provide an upgraded topic-language version
3. If topic: mark as PASS

OUTPUT FORMAT (YAML):
```yaml
query_refinement:
  passed:
    - query: "[original query]"
      theme_id: T_XX
  upgraded:
    - original: "[discourse query]"
      problem: "[why it's discourse language]"
      upgraded: "[topic language version]"
      theme_id: T_XX
  killed:
    - query: "[query]"
      reason: "[why no good upgrade exists]"
      theme_id: T_XX
```

Be strict. If the query sounds like a Reddit title, upgrade it.
```

### Process Results

1. **REPLACE** discourse queries with upgraded versions
2. **KILL** queries where no good upgrade exists
3. Log changes in `query_refinement_log`
4. Proceed with refined queries

**If more than 50% of queries need upgrading:** The theme-to-query generation is systematically using discourse language. Review the theme sample_quotes and ensure queries derive from TOPIC, not QUOTE.

---

## COMPLETION RULE

Done when:
- All themes have 2-3 queries
- Platform heat bonuses applied
- Diversity minimums met
- Queries linked to themes
- Target platforms specified
- No overlap with previous iterations
- **Query refinement gate passed**

---

## NEXT STEP

`queries[]` (refined) → SEARCH (orchestrator handles) → `steps/2b_extract_items.md`
