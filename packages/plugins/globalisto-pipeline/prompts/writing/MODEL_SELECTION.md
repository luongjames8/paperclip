# Writing Module - Model Selection

## Decision

| Use Case | Model | Rationale |
|----------|-------|-----------|
| **Production** | Opus single-pass | Emotional precision required |
| **Integration testing** | DeepSeek single-pass | Fast, cheap, catches structural issues |

---

## Why Opus for Production

The writing phase requires emotional precision that DeepSeek cannot reliably deliver. After polish, the gap narrows but critical differences remain in:

1. **Turn beats** - where the video pivots emotionally
2. **Closing weight** - final lines that must land without resolution
3. **Viewer implication** - recognition beats that put viewer inside the behavior

These are not fixable in polish. Polish improves language; it cannot restructure emotional logic.

---

## Evidence: Side-by-Side Comparison

Test conducted 2026-01-17 on topic `parenting_revealed_preferences`.

### Section 5 - THE TURN (Most critical emotional beat)

**DeepSeek:**
> Two hours a day. Ten hours a week. Five hundred hours a year.
>
> That's time not spent with children.
>
> **Their children eat dinner without them.**

**Opus:**
> Two hours a day. Five hundred hours a year.
>
> That's time with their children.
>
> **The optimization for children's futures extracts it from children's present. The premium for education is paid in presence.**

| | DeepSeek | Opus |
|-|----------|------|
| What it does | States consequence | Crystallizes irony |
| Emotional function | Tells you what happens | Makes you feel the paradox |
| MIRROR compliance | Adequate | Precise |

---

### Section 9 - AWARENESS CLOSURE (Final weight)

**DeepSeek:**
> Because the number is on the screen and you can't unsee it. Because your child only gets one chance. Because you can't be the one who didn't try.
>
> **Now they live with what they chose.**

**Opus:**
> Because the mortgage was signed before awareness arrived. The decision was permanent before the contradiction became visible.
>
> **You cannot undo a 30-year commitment with a survey response.**
>
> The resource allocation stands.

| | DeepSeek | Opus |
|-|----------|------|
| What it does | Explains motivation | Closes the trap |
| Risk | Slightly justifies behavior | No escape offered |
| MIRROR compliance | Weak (offers comfort) | Strong (destabilized) |

---

### Section 2 - RECOGNITION (Viewer implication)

**DeepSeek:**
> **Your parents never saw this number.** They drove neighborhoods. Talked to people. You have a score.

**Opus:**
> **The number wasn't there when your parents bought their house. They couldn't filter by it. Couldn't sort by it. Couldn't disqualify every home below a 7.**
>
> You can.
>
> The rating became visible. Visible became unavoidable.

| | DeepSeek | Opus |
|-|----------|------|
| Structure | Statement | Tricolon → accusation |
| Effect | Describes difference | Implicates viewer |
| Recognition beat | Adequate | Precise |

---

## Quantitative Results

### Pre-Polish Scores (40 max)

| Approach | Flow | Emotion | Coherence | Constraints | Total |
|----------|------|---------|-----------|-------------|-------|
| Opus single-pass | 9 | 9 | 10 | 10 | **38** |
| DeepSeek single-pass | 8 | 8 | 9 | 9 | **34** |

### Post-Polish Scores

| Approach | Flow | Emotion | Coherence | Constraints | Total |
|----------|------|---------|-----------|-------------|-------|
| Opus + polish | 9 | 10 | 10 | 10 | **39** |
| DeepSeek + polish | 9 | 8 | 9 | 10 | **37** |

**Gap after polish: 2 points (5%)**

The gap shrinks but does not close. Emotional delivery (the hardest criterion) remains lower for DeepSeek even after polish.

---

## Cost Comparison

| Approach | Write Cost | Polish Cost | Total | Quality |
|----------|------------|-------------|-------|---------|
| Opus single-pass | $0.45 | $0.15 | $0.60 | 39/40 |
| DeepSeek single-pass | $0.01 | $0.15 | $0.16 | 37/40 |

DeepSeek is 73% cheaper but 5% lower quality. For production content where emotional landing matters, the cost difference is not significant enough to accept the quality loss.

---

## When to Use DeepSeek

**Integration testing only:**
- Verifying pipeline connectivity
- Testing prompt structure changes
- Checking citation/beat tracking
- Dry runs before production

DeepSeek catches structural issues (missing beats, citation errors, constraint violations) at 2% of the cost. Use it to validate the pipeline, then run Opus for final output.

---

## Approaches Tested and Rejected

| Approach | Score | Cost | Why Rejected |
|----------|-------|------|--------------|
| Opus section-by-section | 35 | $0.90 | Costs 2x, scores lower - loses cross-section flow |
| DeepSeek section-by-section | 30 | $0.05 | Visible seams, inconsistent voice |
| Route by beat type | 30 | $0.19 | Hybrid seams hurt coherence |
| DS draft + Opus review | 33 | $0.68 | Review step not worth cost |
| Opus bookends + DS middle | 37 | $0.13 | Good value but middle sections weaker |

**Single-pass approaches outperform all hybrid/sectioned approaches** for both models.

---

## Test Artifacts

Full test outputs preserved in:
- `.planning/test_outputs/script_A.md` through `script_G.md` (raw)
- `.planning/test_outputs/script_A_polished.md`, `script_C_polished.md`, `script_D_polished.md`

---

*Last updated: 2026-01-17*
