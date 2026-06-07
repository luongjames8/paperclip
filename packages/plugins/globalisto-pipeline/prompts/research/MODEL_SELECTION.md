# Research Module - Model Selection

## Summary

| Step | Model | Score Gap | Rationale |
|------|-------|-----------|-----------|
| 1. Slot Analysis | Claude | 3.5 vs 4.5 | Strategic query design affects downstream quality |
| 2. Evidence Search | WebSearch + DeepSeek | Fixed | URL parsing is commodity work |
| 3. Beat Generation | Claude | 3.5 vs 4.5 | Narrative framing, counter-evidence typing |
| 4. Counter-Evidence | Claude | 3.0 vs 4.5 | DeepSeek produces hypothetical beats |
| 5. Coverage Validation | Claude | 2.5 vs 5.0 | Handoff notes need analytical depth |

---

## Test Methodology

**Date:** 2026-01-17
**Topic:** Toyota EV Strategy
**Belief:** "Toyota's cautious EV approach is a strategic mistake that will cost them market leadership"

Test files in `.planning/research-test/`:
- `step1_deepseek.yaml`, `step1_claude.yaml`, `step1_comparison.md`
- `step3_deepseek.yaml`, `step3_claude.yaml`, `step3_comparison.md`
- `step4_deepseek.yaml`, `step4_claude.yaml`, `step4_comparison.md`
- `step5_deepseek.yaml`, `step5_claude.yaml`, `step5_comparison.md`

---

## Step-by-Step Findings

### Step 1: Slot Analysis

**Winner: Claude (4.5/5 vs 3.5/5)**

| Aspect | DeepSeek | Claude |
|--------|----------|--------|
| Query specificity | "Toyota EV sales 2024" | "Toyota EV sales 2024 percent units quarterly" |
| Interpretation | Explains what's needed | Explains WHY + framing advice |
| Dependencies | 2 identified | 4 identified, more interconnected |
| Steel-manning | "For balance" | Explicit strategic instruction |

**Why it matters:** Slot analysis is upstream. Generic queries produce generic evidence. Claude's tactical queries ("exact words", "transcript", "percent") find better sources.

**Cost trade-off:** DeepSeek acceptable (3.5/5) if budget-constrained, but quality compounds downstream.

---

### Step 2: Evidence Search

**Fixed: WebSearch + DeepSeek web_fetch**

Not a model comparison - this is locked architecture:
1. WebSearch finds URLs
2. DeepSeek web_fetch parses content

**Rationale:** URL parsing is commodity work. DeepSeek handles it at ~10-20x lower cost. The intelligence is in what to search for (Step 1) and what to do with findings (Steps 3-5).

---

### Step 3: Beat Generation

**Winner: Claude (4.5/5 vs 3.5/5)**

| Aspect | DeepSeek | Claude |
|--------|----------|--------|
| Beat descriptions | "24,000 vs 1.2 million" | "24,000 vs 1.2 million - a 50:1 ratio" |
| Belief pressure | Explains relevance | Frames for narrative impact |
| Counter-evidence typing | "irony", "contradiction" | "reversal", "COMPLICATES belief" |

**Key example:**

DeepSeek belief_pressure:
> "Reveals the massive scale gap between Toyota's flagship EV and market leaders..."

Claude belief_pressure:
> "Raw scale disparity exposes execution gap. This isn't 'behind' - this is irrelevance in the category."

**Why it matters:** Beat generation is where narrative potential emerges. Claude produces beats with energy; DeepSeek produces dry facts.

**Critical difference:** Counter-evidence handling. DeepSeek types AP_05 beats as negative ("irony"). Claude correctly frames them as steel-man ("COMPLICATES belief", "reversal"). Structure needs to know which beats SUPPORT vs COMPLICATE.

**Cost trade-off:** DeepSeek acceptable (3.5/5) for high-volume, lower-stakes content.

---

### Step 4: Counter-Evidence Search

**Winner: Claude (4.5/5 vs 3.0/5)**

| Aspect | DeepSeek | Claude |
|--------|----------|--------|
| Evidence grounding | `evidence_refs: [requires_research]` | Actual sources with URLs |
| Gap identification | Generic categories | Specific market observations |
| Steel-man depth | Abstract framing | Strategic + tactical (Innovator's Dilemma) |
| Structure guidance | 4-point advice | 6-point attack plan |

**Critical flaw in DeepSeek:** Beats say "requires_research" instead of citing evidence.

```yaml
# DeepSeek
evidence_refs: [requires_research]  # Placeholder - defeats the purpose

# Claude
evidence_refs: ["EIA hybrid vehicle sales data 2025", "S&P Global Mobility Q2 2025"]
```

**Why it matters:** Counter-evidence with "requires_research" is worse than no counter-evidence - it creates false confidence that steel-manning was done.

**Cost trade-off:** DeepSeek NOT acceptable for Step 4. Counter-evidence quality determines whether final piece is propaganda or analysis.

---

### Step 5: Coverage Validation

**Winner: Claude (5.0/5 vs 2.5/5)** - Largest gap

| Aspect | DeepSeek | Claude |
|--------|----------|--------|
| Report length | 57 lines | 292 lines |
| Per-slot analysis | Numbers only | Beat types + notes |
| Uniqueness audit | "No duplicates" | 4 pairs examined with justification |
| Narrative patterns | None | 4 patterns identified |
| Structure recommendations | None | 6-point tactical guide |

**What Structure receives:**

From DeepSeek:
- 30 beats exist
- No duplicates
- Ready for structure

From Claude:
- 30 beats exist
- Why 4 potential duplicates are distinct
- Which slots need caution (AP_03 all press sources)
- 4 narrative patterns (Innovator's Dilemma, High-Stakes Timing Bet, China as Leading Indicator, The Akio Toyoda Question)
- 6-point tactical guide for structuring

**Why it matters:** Coverage validation isn't just counting - it's preparing Structure to succeed. DeepSeek provides a checklist; Claude provides a briefing document.

**Cost trade-off:** DeepSeek NOT acceptable for Step 5. A coverage validation that just counts beats provides no value beyond the numbers.

---

## Final Configuration

```yaml
research_module:
  step_1_slot_analysis:
    model: claude
    rationale: "Strategic query design, upstream quality"

  step_2_evidence_search:
    url_discovery: websearch
    content_parsing: deepseek_web_fetch
    rationale: "Fixed - parsing is commodity work"

  step_3_beat_generation:
    model: claude
    rationale: "Narrative framing, counter-evidence typing"

  step_4_counter_evidence:
    model: claude
    rationale: "Must cite real evidence, not placeholders"

  step_5_coverage_validation:
    model: claude
    rationale: "Handoff notes need analytical depth"
```

---

## Cost Considerations

If cost-constrained, the ONLY acceptable DeepSeek substitutions are:
- Step 1 (3.5/5 acceptable, but quality compounds)
- Step 3 (3.5/5 acceptable for high-volume content)

**Never substitute DeepSeek for:**
- Step 4 (hypothetical beats are worse than nothing)
- Step 5 (checklist provides no value to Structure)

---

## Future Testing

Consider re-testing when:
- DeepSeek releases improved models
- New reasoning models become available
- Cost constraints change significantly

Test files preserved in `.planning/research-test/` for reference.
