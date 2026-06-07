# Polish Module - Model Selection

## Summary

| Step | Model |
|------|-------|
| Language Smooth | Opus |

---

## Test Results

**Date:** 2026-01-19
**Test content:** script_A.md (Parenting Revealed Preferences, 9 sections)
**Parameters:** medium=youtube, reading_level=grade_9_10, voice_style=conversational

### Comparison

| Section | Issue | DeepSeek | Opus |
|---------|-------|----------|------|
| 3 | Cut "It isn't Manhattan or San Francisco" | ❌ Removed context | ✅ Kept |
| 3 | Cut "This is the pattern" lead-in | ❌ Weakened rhythm | ✅ Kept as "Coast to coast..." |
| 4 | "A slot" in peer group line | ❌ Cut | ✅ Kept |
| 5 | "to afford these districts" | ❌ Cut | ✅ Kept |
| 6 | "outstanding mortgages" | ❌ Simplified to "mortgages" | ✅ Kept precision |
| 7 | "nearly nine in ten" | ❌ Changed to "nine in ten" | ✅ Kept "nearly" |
| 9 | "not what happens inside the classrooms" | ❌ Cut | ✅ Kept payoff line |

### Verdict

DeepSeek over-cuts. Loses specificity ("outstanding mortgages" → "mortgages"), drops payoff phrases ("not what happens inside the classrooms"), and weakens rhythmic elements. Changes are competent but flatten the script.

Opus preserves more punch and precision while still tightening.

---

## Rationale

Polish preserves voice and rhythm while improving clarity. DeepSeek's aggressive cutting removes load-bearing phrases that contribute to emotional landing.

Key differences:
- DeepSeek treats polish as compression
- Opus treats polish as refinement

For spoken content where rhythm and payoff matter, Opus is required.

---

## Test Artifacts

Full test outputs preserved in `.planning/polish-test/`:
- `deepseek_polish_full.md`
- `opus_polish_full.md`

---

*Last updated: 2026-01-19*
*Status: Tested*
