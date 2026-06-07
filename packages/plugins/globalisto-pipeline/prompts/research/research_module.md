# RESEARCH MODULE

## 🔄 CONTEXT PERSISTENCE (READ FIRST ON RESUME)

**See:** `protocols/CONTEXT_PERSISTENCE.md` for full protocol.

### On Resume

```
1. Read PIPELINE_CHECKLIST.yaml in output directory
2. Check next_action field
3. Resume from there (do NOT restart completed steps)
4. Trust checklist over context summary
```

### Write-First Rule

**All search/fetch results MUST be written to disk BEFORE processing.**

```yaml
# After each slot's evidence search:
1. Run searches for slot
2. IMMEDIATELY write to: raw_evidence/slot_{id}_batch_{n}.yaml
3. Chat shows only: "Wrote 12 sources for AP_01 (total: 24)"
4. After slot complete, read files and generate beats
```

### Checklist Updates

Update `PIPELINE_CHECKLIST.yaml` after:
- Each slot's evidence search complete
- Each slot's beats generated
- Counter-evidence search complete
- Coverage validation complete

---

## MODEL SELECTION

| Step | Model/Tools | Rationale |
|------|-------------|-----------|
| 1. Slot Analysis | Claude | Strategic query design |
| 2. Evidence Search | `deepseek search` + `deepseek fetch` (deepseek CLI) + `mcp__youtube__*` | Deep content extraction |
| 3. Beat Generation | Claude | Narrative framing |
| 4. Counter-Evidence | Claude | Must cite real sources |
| 5. Coverage Validation | Claude | Handoff needs depth |

**Evidence Search tools (explicit):**
- `deepseek search` - find URLs
- `deepseek fetch` - read full page content (DEPTH, not headlines)
- `mcp__youtube__search_videos` - find relevant videos
- `mcp__youtube__fetch_transcript` - extract full transcript

See `MODEL_SELECTION.md` for test results and detailed rationale.

---

## PURPOSE

Fill slots with potential beats by finding evidence and generating options for Structure.

This module handles: analyze slots → search for evidence → generate beats → find counter-evidence → validate coverage.

**This module performs NO structuring or writing.** Output is raw material organized by slot for downstream Structure module.

**PRINCIPLE:** Maximize unique beats. More options = better Structure decisions. Research should NOT self-censor.

---

## INPUTS

| Input | Required | Purpose |
|-------|----------|---------|
| `belief` | Yes | The belief being addressed |
| `provisional_outline` | Yes | Slots to fill (from scaffold OR discovery) |
| `mode` | Yes | `domain_pull` \| `fresh_research` |
| `fact_database` | When mode=domain_pull | Path to domain fact database |
| `domains_required` | When mode=domain_pull | Which domains to pull from |
| `source_hierarchy` | When mode=fresh_research | Prioritized list of source types |
| `research_so_far` | No | Pre-existing research from Discovery to build upon |

### research_so_far (Optional)

When provided, contains research collected during Discovery:

```yaml
research_so_far:
  sources: [...]         # URLs already fetched
  discourse_items: [...]  # Facts/quotes already extracted
  counter_evidence: [...]  # Kill query results (informational only)
```

**Principle: Seed, don't satisfy.**

`research_so_far` is a head start, not the finish line. Discovery research is *exploratory* (wide, shallow). Research module does *production* research (deep, comprehensive).

When `research_so_far` is provided:
- Provided items count toward coverage (with seed cap)
- Research MUST still find fresh sources (see evidence_search.md)
- Research evaluates credibility independently (doesn't trust Discovery's ratings)
- Research runs full counter-evidence search (doesn't skip based on Discovery's results)

### Slot Schema

```yaml
provisional_outline:
  - slot_id: AP_01  # or FPC_01 for scaffold slots
    description: "What this slot needs to cover"
    required: true  # optional, defaults true
```

---

## OUTPUTS

### `POTENTIAL_BEATS.yaml`

All discovered beats organized by slot:

```yaml
potential_beats:
  - id: PB_01
    slot_id: AP_01
    description: "Factual finding (neutral language)"
    belief_pressure: "How this applies pressure to the belief"
    type: reveal | contradiction | escalation | irony | origin | reversal
    evidence_refs: [RM_01, RM_02]
    source: domain_pull | fresh_research | gap_research
```

### `RESEARCH_MASTER.yaml`

Centralized evidence repository:

```yaml
research_master:
  sources:
    - id: RM_01
      type: earnings | filing | press | academic | interview | video_transcript | government | report
      title: "Source title"
      url: "..."
      date: "..."
      credibility: high | medium | low
      timestamp: "[For video sources: MM:SS]"  # optional
  data_points:
    - id: DP_01
      source_ref: RM_01
      fact: "Extracted fact with citation"
      page_or_timestamp: "..."
```

### `COVERAGE_REPORT.yaml`

```yaml
coverage_report:
  - slot_id: AP_01
    beats_found: 7
    status: ADEQUATE  # STRONG (8+), ADEQUATE (5-7), THIN (<5)
  - slot_id: AP_02
    beats_found: 3
    status: THIN  # WARNING - below floor

gaps_identified:
  - AP_02  # Slots with THIN coverage

validation:
  all_slots_have_beats: true  # false = BLOCKER
  all_beats_unique: true
  thin_slots: [AP_02]  # WARNING only
```

---

## PARAMETERS

### mode

| Value | When to Use | Behavior |
|-------|-------------|----------|
| `domain_pull` | Web repos with fact databases (clearframe, surplus-kb, hinomaru) | Check database first, research gaps only |
| `fresh_research` | Standalone video (globalisto, investment-tube) | Search from scratch per slot |

### Coverage Thresholds

| Status | Beats | Meaning |
|--------|-------|---------|
| STRONG | 8+ | Ideal - many options for Structure |
| ADEQUATE | 5-7 | Acceptable - meets floor |
| THIN | <5 | WARNING - consider second pass |

**min_beats_per_slot: 5** (floor, not ceiling)

---

## EXECUTION

This module runs in 5 steps:

### Step 1: Slot Analysis
**Prompt:** `steps/slot_analysis.md`

Understand what each slot needs. Decompose vague slots into searchable queries.
- INPUT: `provisional_outline`, `belief`
- OUTPUT: `slot_queries` (search strategy per slot)

### Step 2: Evidence Search
**Prompt:** `steps/evidence_search.md`

Find evidence for each slot using mode-appropriate strategy.
- INPUT: `slot_queries`, `mode`, `source_hierarchy` or `fact_database`
- OUTPUT: `raw_evidence` (facts organized by slot)

**IMPLEMENTATION (FIXED):**
```
Web sources:
1. deepseek search → find URLs
2. deepseek fetch → read FULL content (not headlines)
3. Extract 3-5+ facts per source (DEPTH requirement)
4. Follow citations to primary sources

YouTube sources (when relevant):
1. mcp__youtube__search_videos → find videos
2. mcp__youtube__fetch_transcript → read full transcript
3. Extract facts with timestamps
```

Non-negotiable. Use these exact MCP tools.

---

#### Gate: Fetch Count Validation

**AFTER evidence_search:** Ensure minimum web fetches per slot.

```bash
npx tsx prompts/enforcement/cli.ts research:fetch_count @raw_evidence.yaml --output-dir .
```

**Input:** `raw_evidence.yaml` with slot fetch counts:

```json
{
  "slots": [
    { "slot_id": "AP_01", "fetch_count": 7 },
    { "slot_id": "AP_02", "fetch_count": 5 }
  ]
}
```

**Actions:**
- `CONTINUE`: All slots meet minimum (5 fetches) - proceed to beat_generation
- `LOOP`: Insufficient fetches - re-run evidence_search for listed slots

**Recovery on LOOP:**
1. Check `metadata.insufficient_slots` in gate output
2. Run additional searches ONLY for those slots
3. Write new evidence to `raw_evidence/slot_{id}_batch_{n+1}.yaml`
4. Re-run gate (max 3 iterations before escalating to BLOCK)

---

### Step 3: Beat Generation
**Prompt:** `steps/beat_generation.md`

Generate potential beats from evidence. Maximize unique options.
- INPUT: `raw_evidence`, `belief`
- OUTPUT: `potential_beats` (5+ per slot, deduplicated)

### Step 4: Counter-Evidence Search
**Prompt:** `steps/counter_evidence.md`

Actively search for what would weaken the angle. Add as beats.
- INPUT: `potential_beats`, `belief`
- OUTPUT: `potential_beats` (updated with counter-evidence beats)

### Step 5: Coverage Validation
**Prompt:** `steps/coverage_validation.md`

Check coverage, flag thin slots, ensure uniqueness.
- INPUT: `potential_beats`
- OUTPUT: `coverage_report`, `gaps_identified`

---

#### Gate: Source Diversity Check

**AFTER coverage_validation:** Ensure source diversity per slot.

```bash
npx tsx prompts/enforcement/cli.ts research:source_diversity @coverage_report.yaml --output-dir .
```

**Input:** `coverage_report.yaml` with source information:

```json
{
  "slots": [
    {
      "slot_id": "AP_01",
      "sources": [
        { "id": "SRC_01", "type": "news", "beat_count": 3 },
        { "id": "SRC_02", "type": "academic", "beat_count": 2 },
        { "id": "SRC_03", "type": "government", "beat_count": 2 }
      ],
      "total_beats": 7
    }
  ]
}
```

**Diversity requirements (configurable in config.yaml):**
- Min 3 distinct sources per slot
- Min 2 source types per slot
- No single source > 40% of beats

**Actions:**
- `CONTINUE`: All diversity requirements met - proceed to Structure
- `CONTINUE` with `warning: true`: Diversity issues found - flag in `handoff_notes`, proceed

**Note:** This gate does NOT block. Diversity issues are warnings only.

**On WARNING:**
1. Log warnings to `GATE_WARNINGS.yaml`
2. Include in `handoff_notes` for Structure module awareness
3. Continue pipeline - manual review recommended

---

## HARD CONSTRAINTS (NON-NEGOTIABLE)

This module may NOT:
- Structure or order beats (that's Structure's job)
- Write prose or draft content
- Invent facts not found in sources
- Skip counter-evidence search
- Block pipeline for THIN coverage (warning only)

This module MUST:
- Generate at least 5 beats per slot (floor)
- Search for counter-evidence actively
- Deduplicate beats (no two saying the same thing)
- Tag every beat with evidence_refs
- Block if ANY required slot has ZERO beats

---

## PRINCIPLES

1. **Maximize options** - more unique beats = better Structure decisions
2. **Floor not ceiling** - 5 minimum, no maximum
3. **Counter-evidence is mandatory** - actively seek what weakens the angle
4. **Uniqueness over volume** - 10 unique beats > 20 redundant ones
5. **Source diversity** - no single source dominates
6. **Tag everything** - every beat traces to research_master

---

## MODE-SPECIFIC BEHAVIOR

### domain_pull (web repos)

```
For each slot:
  1. Query fact database for relevant facts
  2. Pull matching facts as potential beats
  3. Identify gaps (slots with insufficient coverage)
  4. Fresh research for gaps only
  5. Tag source: domain_pull vs gap_research
```

Benefits:
- Consistency across pages (same facts, same wording)
- Faster execution (database lookup vs web search)
- Cross-linking support (PRIMARY vs REFERENCE in Structure)

### fresh_research (video repos)

```
For each slot:
  1. Generate search queries from slot description
  2. deepseek search for URLs
  3. deepseek fetch each URL (read FULL content)
  4. Extract 3-5+ facts per source (DEPTH)
  5. mcp__youtube__search_videos for relevant videos
  6. mcp__youtube__fetch_transcript for video content
  7. Follow citations to primary sources
  8. Generate potential beats from all evidence
  9. Search for counter-evidence
```

Benefits:
- Each video is self-contained
- Research tailored to specific angle
- No fact staleness concerns
- Deep extraction, not headline skimming

---

## INTEGRATION

### Upstream Dependencies
- Discovery phase: `belief`, `provisional_outline` (slots)
- OR Scaffold: predefined `provisional_outline` (FPCs)

### Downstream
- Structure module: consumes `POTENTIAL_BEATS.yaml`, `RESEARCH_MASTER.yaml`
- Gap research may loop back for THIN slots (optional)

### Handoff to Structure

Research output maps to Structure input:
- `potential_beats` → `potential_material` (flattened)
- `belief` → `belief` (pass-through)
- `research_master` → available during Writing for citations

Required additions for Structure:
- `content_class`: detonator | mirror
- `medium`: video | web_page | article
- `domain`: optional but recommended
- `page_type`: required if medium == web_page

---

*Steps reference patterns from globalisto, clearframe, surplus-kb, investment-tube research phases.*
