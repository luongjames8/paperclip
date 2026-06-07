# 2b: EXTRACT ITEMS (v2)

## SINGLE CONCERN

Structure raw search results into discourse items with required URLs for verification.

**v2 Change:** URLs are now REQUIRED. Fetch status is tracked for verification gate.

---

## INPUT

| Input | Source |
|-------|--------|
| `websearch_results` | Markdown from WebSearch (forums, Reddit, Quora, YouTube) |
| `queries[]` | Queries with theme_id from 2a |
| `time_window_months` | How far back to include (default: 12) |

---

## OUTPUT

```yaml
status: SUFFICIENT  # or INSUFFICIENT

discourse_items:
  - id: D_01
    url: "https://reddit.com/r/japanlife/comments/abc123"
    excerpt: |
      Been here 10 years, just switched to my 4th company.
      The whole 'Japanese don't job hop' thing is so outdated...
    source_type: reddit
    platform: r/japanlife
    date: "2024-02"
    fetch_status: unfetchable  # Reddit 403s
    theme_id: T_01

  - id: D_02
    url: "https://japantimes.co.jp/news/2024/01/job-mobility-survey"
    excerpt: |
      Survey shows 40% of workers under 35 have changed jobs at least once,
      up from 25% a decade ago.
    source_type: news
    platform: Japan Times
    date: "2024-01"
    fetch_status: fetched
    raw_content: "[full article text stored here]"
    theme_id: T_01

  - id: D_03
    url: "https://quora.com/What-is-working-in-Japan-really-like/answer/..."
    excerpt: |
      My wife's company still does the whole 'leave when the boss leaves' thing.
      It's theater, not work.
    source_type: forum
    platform: Quora
    date: "2024-01"
    fetch_status: unfetchable  # Quora 403s
    theme_id: T_02

fetch_log:
  - url: "https://japantimes.co.jp/..."
    status: fetched
    duration_ms: 1250
  - url: "https://reddit.com/..."
    status: unfetchable
    error: "HTTP 403"
    duration_ms: 340
```

---

## PROCESS

### 1. Execute searches (batch of 3 parallel)

For each query from 2a:
- Run WebSearch
- Extract from each result:
  - title
  - snippet
  - url (REQUIRED)
  - date (if available)

### 2. Deduplicate URLs

Remove duplicate URLs across all search results:
- Normalize URLs (strip tracking params)
- Keep first occurrence
- Log duplicates found

### 3. Prioritize fetches

Order URLs for fetching by:
1. **Source type priority:** article > forum > reddit > other
2. **Recency:** newer first
3. **Domain diversity:** prefer URLs from new domains

### 4. Fetch content (using MCP web_fetch)

**Use MCP `web_fetch` tool for each prioritized URL up to fetch_budget.**

```
fetch_budget:
  base: 20              # Up from 15 - supports 25+ items target
  increase_per_js_fail: 1
  max: 30               # Up from 25
```

For each fetch:
- On success: Store full content in `raw_content`, mark `fetched`
- On 403: Mark `unfetchable`, log error
- On JS-required (empty content): Mark `js_required`, increase budget
- On timeout: Mark `timeout`, log error

### 5. Extract discourse items

For each search result (fetched or not):

| Field | Source |
|-------|--------|
| `id` | Sequential D_01, D_02... |
| `url` | From search result (REQUIRED) |
| `excerpt` | From snippet OR fetched content (prefer fetched) |
| `source_type` | Classify from URL/content |
| `platform` | Extract from URL |
| `date` | From content or search result |
| `fetch_status` | fetched \| unfetchable \| js_required \| timeout |
| `raw_content` | Full page text if fetched |
| `theme_id` | From originating query |

---

## URL REQUIREMENTS (v2)

**Every discourse item MUST have a valid URL.**

| Requirement | Rule |
|-------------|------|
| Format | Full URL starting with http:// or https:// |
| Uniqueness | No duplicate URLs in output |
| Validity | Must be a real source URL, not a redirect |

### Handling search results without URLs

If WebSearch returns a result without a clear URL:
- Skip that result
- Log: "Result skipped: no URL available"

---

## FETCH STATUS TRACKING (v2)

Track fetch status for verification gate:

| Status | Meaning | Verification Impact |
|--------|---------|---------------------|
| `fetched` | Content successfully retrieved | Can verify quotes directly |
| `unfetchable` | 403 or similar block | Must use snippet verification |
| `js_required` | Page loads but content is JS-rendered | Cannot verify, increase budget |
| `timeout` | Request timed out | Must use snippet verification |

---

## SOURCE STRATEGY

### Unfetchable sources (403 problem)

These block fetching—compensate with **search volume**:

| Source | Expected Status | Compensation |
|--------|-----------------|--------------|
| Reddit | unfetchable | Extract quote from WebSearch snippet |
| Quora | unfetchable | Extract quote from WebSearch snippet |
| Twitter/X | unfetchable | Extract quote from WebSearch snippet |

WebSearch snippets contain actual quotes—they're valid for SUPPORTED verification.

### Fetchable sources (prioritize)

These work—**always attempt fetch for full context**:

| Source | Expected Status | Priority |
|--------|-----------------|----------|
| Wikipedia | fetched | HIGH |
| News sites | fetched | HIGH |
| Blogs | fetched | MEDIUM |
| Government | fetched | HIGH |

---

## RATE LIMITING

Use these limits when calling MCP web_fetch:

| Limit | Value |
|-------|-------|
| Per domain concurrent | 2 |
| Per domain delay | 1000ms |
| Global concurrent | 5 |
| Timeout per request | 15000ms |

---

## QUANTITY TARGETS

### Minimum thresholds

- **25+ discourse items total** (feeds belief extraction funnel)
- 8+ from Reddit/forums (first-person voices)
- 5+ successfully fetched
- 4+ distinct source types
- 5+ distinct domains

### Quality markers

- Items span multiple themes (not all same angle)
- Include both supporting AND challenging views
- At least 2 items with hard data/statistics
- Multiple perspectives on same theme (not just echo chamber)

---

## HARD CONSTRAINTS

- Extract items ONLY (do not classify or analyze)
- Every item MUST have a URL
- Must capture actual text (not summaries)
- Must track fetch_status for each item
- Must respect time window
- Must assign unique IDs
- Link items to originating theme_id

---

## SUFFICIENCY CHECK

Before completing, verify:

### Breadth

- [ ] **25+ discourse items extracted**
- [ ] 4+ distinct source types
- [ ] Items span multiple themes
- [ ] 8+ items from Reddit/forums

### Depth

- [ ] 5+ items from successful fetches
- [ ] At least 2 news/analysis articles fetched
- [ ] At least 2 items with statistics or data

### URL coverage

- [ ] All items have valid URLs
- [ ] No duplicate URLs
- [ ] Fetch attempted for top priority URLs

If insufficient:

```yaml
status: INSUFFICIENT
items_found: 6
sources_found: ["japantimes.co.jp", "Wikipedia"]
breadth_gaps: "Need Reddit/forum discourse for first-person views"
depth_gaps: "No full articles fetched, missing statistics"
fetch_issues: "4 URLs returned 403, 2 timed out"
recommendation:
  - "Run 3+ WebSearches with site:reddit.com for more snippets"
  - "Fetch Japan Times or East Asia Forum articles"
  - "Search for government labor statistics"
```

---

## COMPLETION RULE

Done when:
- **25+ discourse items extracted**
- Every item has URL and fetch_status
- 8+ from Reddit/forums
- 5+ successfully fetched
- 4+ source types represented
- 5+ distinct domains
- Items within time window
- fetch_log complete

---

## NEXT STEP

`discourse_items[]` → `steps/2c_identify_beliefs.md`
