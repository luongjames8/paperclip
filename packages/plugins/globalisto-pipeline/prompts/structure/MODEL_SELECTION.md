# Structure Module: Model Selection

## Recommendation

**Use Opus for all 7 steps.**

## Testing Summary

Tested all steps with DeepSeek-chat vs Opus (2026-01-17). Full results in `.planning/STRUCTURE_MODEL_COMPARISON.md`.

| Step | DeepSeek | Opus | DeepSeek Suitable? |
|------|----------|------|-------------------|
| 1. Classification | 3.5/5 | 4.5/5 | No |
| 2. Selection | 4/5 | 4.5/5 | Yes |
| 3. Ordering | 3.5/5 | 4.5/5 | No |
| 4. Evidence Assignment | 3/5 | 4.5/5 | No |
| 5. Validation | 2.5/5 | 4.5/5 | No |
| 6. Enrichment Routing | 3.5/5 | 4.5/5 | No |
| 7. Gap Identification | 2.5/5 | 4.5/5 | No |

## Why Opus?

### DeepSeek Weaknesses Found

1. **Overly literal interpretation** - DeepSeek applies rules too strictly, missing implicit scope and nuance
2. **False-positive blocking** - Steps 5 and 7 blocked valid structures that Opus correctly passed
3. **Poor judgment calls** - Struggles with "what is load-bearing?" and "is this addressed implicitly?"
4. **Documentation errors** - Counting mistakes in Step 4 (reported 6 primary claims instead of 3)

### Critical Issues at Steps 5 and 7

**Step 5 (Validation):**
- DeepSeek: FAIL (4 high-severity "NOT ADDRESSED" objections)
- Opus: PASS (objections addressed implicitly or scoped out by 90% statistic)
- DeepSeek would have blocked a valid structure

**Step 7 (Gap Identification):**
- DeepSeek: Cannot proceed (1 critical gap)
- Opus: Can proceed (gap is clarification, not validation)
- DeepSeek over-classified importance of gaps

### Specific Step Failures

| Step | DeepSeek Error |
|------|----------------|
| 1 | F5 (inspection issues) classified as SS instead of SM - missed that it attacks the fear objection |
| 3 | F3 (lawyer cost) attached to UNIT_001 instead of UNIT_002 - cost supports "redundant service" argument |
| 4 | Counted 6 primary claims instead of 3; listed SUPPORTING facts in claims_established |
| 5 | Required explicit refutation of every possible objection instead of recognizing implicit addressing |
| 6 | Placed anecdote in UNIT_001 instead of landing (UNIT_003) - missed that it's proof of thesis |
| 7 | Classified title company clarification as CRITICAL/blocking instead of IMPORTANT/strengthening |

## Cost-Quality Tradeoff

- Only Step 2 is safely delegable to DeepSeek
- 1 step = ~14% token reduction
- Risk of false-positive blocking outweighs cost savings

## selection_mode Considerations

When using `comprehensive` mode, Opus is even more strongly recommended for Step 2 (Selection). The relaxed redundancy criteria require nuanced judgment about whether two units apply "similar pressure through different evidence or emotional register" — exactly the kind of judgment where DeepSeek's literal interpretation fails.

## When to Reconsider

Re-test if:
- DeepSeek releases a model update with improved reasoning
- Prompt engineering makes DeepSeek's interpretation less literal
- Cost pressure requires hybrid approach (accept Step 5/7 risk)

## Test Data

Test used belief: "You need a lawyer to handle real estate contracts" (detonator, video, legal domain).

Full test outputs in `.planning/structure-test/`.
