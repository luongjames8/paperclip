# Packaging Module - Model Selection

## Summary

| Step | Model | Rationale |
|------|-------|-----------|
| 1. Competitor Scan | DeepSeek (or Opus) | DeepSeek web_search is cheaper |
| 2. Title Generation | DeepSeek | Same primary title |
| 3. Shorts Extraction | Opus | Strategic alignment |
| 4. Midroll Placement | DeepSeek | Identical positions |
| 5. Description | Opus | Better hooks |

**Default**: Steps 1,3,5 Opus + Steps 2,4 DeepSeek = ~60% cost reduction vs all-Opus

---

## Test Methodology

**Date:** 2026-01-19
**Test ID:** RUN_20260119_1026
**Video:** S2-1 Layoff Lie

Test artifacts in `_packaging/algorithm_tests/RUN_20260119_1026/`

---

## Step-by-Step Findings

### Step 1: Competitor Scan

The deepseek CLI has web search built in. Use it for cost savings.

| Approach | Workflow | Cost | Quality |
|----------|----------|------|---------|
| DeepSeek | `deepseek search` (deepseek CLI) + analysis | $ | ★★★ |
| Opus | Opus WebSearch + analysis | $$$ | ★★★ |

**Use DeepSeek for cost savings; Opus if DeepSeek fails.**

---

### Step 2: Title Generation

Both models converged on the same primary title ("The Man Who Invented Layoffs"). Opus provided stronger secondary options and editorial guidance, but primary output was identical.

**Use DeepSeek for cost; Opus if evaluating multiple options.**

---

### Step 3: Shorts Extraction

Opus outperformed on excerpt selection:
- Chose salary gap stat ($175K vs $212M) - more shareable than DeepSeek's revenue stats
- Named Jack Welch as villain (aligns with title strategy); DeepSeek used Pfeffer quote
- Added release strategy modifications with reasoning

**Use Opus for strategic alignment.**

---

### Step 4: Midroll Placement

DeepSeek and Opus produced identical ad positions (3:15, 6:28, 12:25). Opus provided richer rationale but positions were the same.

**Use DeepSeek for cost savings.**

---

### Step 5: Description Generation

Opus significantly outperformed DeepSeek:
- Hook length: Opus 92 chars (perfect) vs DeepSeek 178 chars (truncated)
- Stat inclusion: Opus included "262,000" stat, DeepSeek omitted
- SEO metadata: Opus added search_intent + title_alignment fields

**Use Opus for quality.**

---

## Cost-Quality Tradeoff

| Scenario | Use DeepSeek | Use Opus |
|----------|--------------|----------|
| Routine production | Steps 2, 4 | Steps 1, 3, 5 |
| Quality-critical | Step 4 only | Steps 1, 2, 3, 5 |
| Maximum savings | All steps | None (accept quality hit) |
| No human review | None | All steps |

---

## Override Guidance

Use Opus for ALL steps when:
- Brand voice is critical
- Topic is complex/nuanced
- Output will be used without human review

---

## Full Test Analysis

See `_packaging/algorithm_tests/RUN_20260119_1026/COMPARISON.md` for detailed side-by-side comparison.

---

*Last updated: 2026-01-19*
