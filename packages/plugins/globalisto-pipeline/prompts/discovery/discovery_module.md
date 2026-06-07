# DISCOVERY MODULE v2

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
# After each search batch:
1. Run 3 parallel web_search calls
2. IMMEDIATELY write to: raw_searches/batch_{n}.yaml
3. Chat shows only: "Wrote 15 results to batch_01.yaml (total: 32)"
4. After ALL searches, read files back and process
```

### Checklist Updates

Update `PIPELINE_CHECKLIST.yaml` after:
- Every step completion
- Every gate execution (pass or fail)
- Every phase transition

---

## ⛔ GATE ENFORCEMENT

After gated steps, you MUST:
1. Write artifact to JSON file
2. Call gate via Bash
3. Paste gate output in your response

**No gate output = invalid.**

| After | Command |
|-------|---------|
| init | `npx tsx enforcement/runner.ts init @init.json` |
| 1_recon | `npx tsx enforcement/runner.ts step 1_recon @recon.json` |
| 2b | `npx tsx enforcement/runner.ts step 2b @step2b.json` |
| 2c | `npx tsx verification/deterministic.ts verify @beliefs.json` |
| 5_gap_check | `npx tsx enforcement/runner.ts step 5_gap_check @gap.json` |
| 5b | `npx tsx verification/deterministic.ts verify @invalidators.json` |
| 5c (each) | `npx tsx enforcement/runner.ts step 5c @step5c.json` |
| before 6a | `npx tsx enforcement/gates.ts gateShape @belief.json` |
| end | `npx tsx enforcement/runner.ts finalize` |

If `pass: false` → **STOP** or apply override.

---

## Tool Preferences

| Task | Use |
|------|-----|
| Web search | `deepseek search` (deepseek CLI) |
| Web fetch | `deepseek fetch` (deepseek CLI) |
| YouTube search | `mcp__youtube-transcript__search_videos` |
| YouTube transcript | `mcp__youtube-transcript__fetch_transcript` |
| Reasoning | Opus (you) |

---

## Source Types

| Source | Discovery Flow |
|--------|----------------|
| Articles | `web_search` → `web_fetch` |
| Reddit | `web_search site:reddit.com` → `web_fetch` (old.reddit.com) |
| YouTube | `search_videos` → `fetch_transcript` |

### YouTube Workflow

In Phase 1 (RECON) or Phase 3 (DEEP DIVE), include YouTube as a source:

```
1. search_videos("topic keywords", { max_results: 5, duration: "medium" })
   → Returns videos with captions

2. For promising videos:
   fetch_transcript(url)
   → Extract as discourse items (speaker quotes, claims, data)
```

**Treat transcript segments as quotable sources** - include video URL + timestamp.

---

## Flow

```
Phase 1: RECON (30-50 searches)
  1_recon → themes[], platform_heat_map
  ⛔ runner step 1_recon

Phase 2: QUERIES
  2a_generate_queries ← themes

Phase 3: DEEP DIVE (35-50 searches, 15-25 fetches)
  WebSearch + web_fetch → discourse_items
  2b_extract_items (25+ items required)
  ⛔ runner step 2b (sufficiency gate)

Phase 4: BELIEF EXTRACTION
  2c_identify_beliefs → beliefs with supporting_quotes
  ⛔ verification/deterministic.ts (quote verification)

Phase 5: GAP CHECK
  5_gap_check → iterate | sufficient
  ⛔ runner step 5_gap_check

Phase 6: VALIDATION (kill queries)
  For each verified belief:
    5a → 5b → ⛔ verify invalidators → 5c
    ⛔ runner step 5c

Phase 7: SLOTS
  ⛔ gateShape
  6a → 6b → 6c → 6d
  ⛔ runner finalize
```

---

## Verification (v2 core change)

Beliefs require verified quotes:
- `VERIFIED` (2pts): URL fetched, quote found
- `SUPPORTED` (1pt): Quote in search snippet only
- `UNVERIFIED` (0pts): Cannot confirm

**Accept if:** total_points ≥ 3, verified_count ≥ 1, unique_domains ≥ 2

---

## Inputs

| Input | Required |
|-------|----------|
| `topic` | Yes |
| `audience_context` | No |

## Outputs

| File | Purpose |
|------|---------|
| `DISCOVERY_RESULT.yaml` | Belief + slots + verification audit |
| `RESEARCH_SO_FAR.yaml` | Sources for Research module |

---

## Concurrency

| Operation | Max Parallel |
|-----------|--------------|
| web_search | 3 |
| web_fetch | 2 |
| search_videos | 2 |
| fetch_transcript | 2 |

---

## Reference

| What | Where |
|------|-------|
| Step prompts | `steps/*.md` |
| Gate logic | `enforcement/ENFORCEMENT_SPEC.md` |
| Verification | `verification/deterministic.ts` |
| Schemas | `discovery_config.schema.yaml` |
