# STEP 2: EVIDENCE SEARCH

## PURPOSE

Find evidence for each slot using mode-appropriate strategy.

This step answers: "What facts exist that could fill these slots?"

---

## Pre-Fetched Search Results

The following search results and page content have been pre-fetched for the slots in this research step. Analyze them directly — do NOT attempt to call any tools.

{pre_fetched_data}

## IMPLEMENTATION

### For fresh_research mode (web sources):

Work from the pre-fetched data above. For each slot:
1. Identify the relevant pre-fetched URLs and page content
2. For EACH source:
   a. Read thoroughly — not just intro/headlines
   b. Extract ALL relevant facts (minimum 3 per quality source)
   c. Note specific quotes, numbers, dates, named examples
3. If a source cites primary data (study, filing, report), note it as a gap for follow-up
4. Write to raw_evidence before moving to next slot

**DEPTH REQUIREMENT:** Each fetched source should yield 3-5 facts. If a source only gives 1 headline-level fact, it's a thin source — note this.

---

### For YouTube sources (expert interviews, talks, presentations):

The pre-fetched data may include YouTube search results and transcripts. For video content:
1. Locate relevant video results in the pre-fetched data
2. For EACH relevant video with transcript content:
   a. Read the transcript thoroughly
   b. Extract specific claims, quotes, data mentioned
   c. Note timestamps for key facts
3. Tag source type as "video_transcript"

**When to use YouTube:** Topic involves experts who speak publicly, industry conferences, company presentations, educational content.

---

### For domain_pull mode:

- Query local fact database directly
- No web search needed unless filling gaps
- Gap-filling follows fresh_research flow above

---

### Angle Orientation (PRIMARY TRACK)

Before executing any searches, read `ANGLE_LOCK.yaml` to orient evidence collection:

- PRIMARY TRACK: Search for evidence that SUPPORTS the locked angle's promise
- Evidence should directly serve the narrative implied by the title
- Prioritize sources that confirm, illustrate, or escalate the locked angle

---

## INPUT

| Input | Source |
|-------|--------|
| `slot_queries` | From Step 1 (search queries per slot) |
| `mode` | `domain_pull` or `fresh_research` |
| `source_hierarchy` | Prioritized source types (fresh_research mode) |
| `fact_database` | Path to fact database (domain_pull mode) |
| `research_so_far` | Optional: pre-existing research from Discovery |
| `ANGLE_LOCK.yaml` | From Angle Generation (provisional lock) |

---

## OUTPUT

### `raw_evidence.yaml`

```yaml
raw_evidence:
  - slot_id: AP_01
    findings:
      - id: EV_001
        fact: "[Extracted fact, neutrally stated]"
        source:
          id: RM_01
          type: earnings | filing | press | academic | interview | video_transcript
          title: "[Source title]"
          url: "[URL]"
          date: "[Date]"
          credibility: high | medium | low
          timestamp: "[For video sources: MM:SS or HH:MM:SS]"
        extraction: "[Quote or data point as found]"
        notes: "[Any context needed]"
```

### `research_master.yaml` (built incrementally)

```yaml
research_master:
  sources:
    - id: RM_01
      type: "[source type]"
      title: "[title]"
      url: "[url]"
      date: "[date]"
      credibility: high | medium | low
```

---

## HANDLING research_so_far (OPTIONAL)

When `research_so_far` is provided, apply these rules:

### Seed Cap: 3 Items Max

Provided items count as **maximum 3 beats** per slot toward coverage:

```
provided_items_for_slot = research_so_far items matching slot
seed_contribution = min(provided_items_for_slot, 3)
```

Even if Discovery found 6 items for a slot, only count 3 toward coverage. Preseed is bonus, not replacement.

### Fresh Requirement: 5 Sources

**MUST find at least 5 NEW sources per slot** (same as without research_so_far):
- Different URLs from research_so_far.sources
- Different authors where applicable
- Fresh research, not just re-using Discovery

### Source Depth

For each provided source, consider:
- Follow citations (find primary sources)
- Search for related academic work
- Find opposing viewpoints

### Coverage Calculation

```
beats_from_provided = min(research_so_far items for slot, 3)  # Seed cap
beats_from_fresh = fresh research items for slot              # Must be 5+
total_beats = beats_from_provided + beats_from_fresh

# Example with research_so_far:
# Preseed: 3 (capped from 5 provided)
# Fresh: 5 (required minimum)
# Total: 8 (STRONG)
```

| Scenario | From Preseed | Fresh Required | Total Min |
|----------|--------------|----------------|-----------|
| No research_so_far | 0 | 5 | 5 (ADEQUATE) |
| With research_so_far | up to 3 | 5 | 8 (STRONG) |

### Credibility Re-evaluation

Research evaluates source credibility independently. Discovery's credibility ratings are hints, not verdicts.

---

## MODE: FRESH_RESEARCH

For standalone content (globalisto, investment-tube).

### Algorithm

```
For each slot in slot_queries:
  For each query in slot.search_queries:
    1. Locate pre-fetched search results for this query (from pre_fetched_data above)
    2. Read full page content from pre-fetched sources
    3. Extract 3-5+ facts per source (DEPTH)
    4. Locate pre-fetched YouTube results for expert content
    5. Read pre-fetched video transcripts where available
    6. Document ALL sources in research_master
    7. Tag finding with source_ref
```

### Source Hierarchy Usage

Higher = more credible, search first.

```yaml
# Example: globalisto
source_hierarchy:
  - Primary documents (filings, official reports)  # Highest priority
  - Asian-language primary sources
  - Expert video content (interviews, talks)  # YouTube transcripts
  - Company earnings/filings
  - Academic papers
  - Industry publications
  - Mainstream press  # Lowest priority
```

**Search in order.** If high-priority sources have the fact, don't dilute with lower sources.

### Source Diversity Rule

Per slot:
- Minimum 3 distinct sources
- At least 2 different source types
- No single source > 40% of findings

---

## MODE: DOMAIN_PULL

For web content with fact databases (clearframe, surplus-kb, hinomaru).

### Algorithm

```
For each slot in slot_queries:
  1. Query fact_database for relevant facts
  2. Pull matching facts into raw_evidence
  3. Tag source: domain_pull

  If slot coverage < adequate:
    4. Fresh research for gaps
    5. Tag source: gap_research
```

### Fact Database Query

Match slot description and evidence types against database entries.

```yaml
# Query pattern
query:
  slot_interpretation: "[from slot_queries]"
  evidence_types: [quantitative, case-based]
  domains_required: [legal, professional]
```

### Gap Research

If domain_pull returns < 5 facts for a slot:
1. Fall back to fresh_research for that slot
2. Tag those findings as `gap_research`
3. Consider adding to fact database later

---

## EVIDENCE EXTRACTION RULES

### What to Extract

| Extract | Example |
|---------|---------|
| Specific numbers | "Sales dropped 15% YoY" |
| Named examples | "Toyota bZ4X recalled in June 2022" |
| Direct quotes | "Akio Toyoda said '...'" |
| Dated events | "In Q3 2024, Toyota announced..." |
| Causal claims | "Due to battery issues, the launch was delayed" |

### What NOT to Extract

| Skip | Why |
|------|-----|
| Vague claims | "Many experts believe..." (who?) |
| Undated generalizations | "Toyota has struggled" (when?) |
| Opinion without attribution | "EVs are the future" (says who?) |
| Redundant facts | Same fact from worse source |

### Neutral Language

Extract facts neutrally. Interpretation comes in beat generation.

| Bad | Good |
|-----|------|
| "Toyota foolishly ignored EVs" | "Toyota's EV investment was $X vs BYD's $Y" |
| "Leadership was in denial" | "Akio Toyoda stated: '[exact quote]'" |

---

## SOURCE CREDIBILITY ASSESSMENT

| Credibility | Criteria |
|-------------|----------|
| **HIGH** | Primary source, official filing, peer-reviewed, direct quote from principal |
| **MEDIUM** | Reputable publication, named sources, verifiable claims |
| **LOW** | Aggregator, anonymous sources, opinion without evidence |

**Default to MEDIUM if unsure.** Flag questionable sources.

---

## HARD CONSTRAINTS

- Every finding must have source reference
- Source diversity: 3+ sources, 2+ types per slot
- No invented facts
- Extract verbatim quotes where possible
- Neutral language in fact statements
- Build research_master incrementally
- Evidence search MUST be oriented toward the locked angle's promise
- Do NOT search generically — every query should serve the title's implicit question

---

## COMPLETION RULE

You are done when:
- All slots have findings
- Each finding has source documented in research_master
- Source diversity met per slot
- Credibility assessed for each source
- Gap research done for thin slots (domain_pull mode)

---

## NEXT STEP

`raw_evidence` → `steps/beat_generation.md`

Evidence becomes potential beats.
