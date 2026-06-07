# Narrative Fix

## One Job

Fix ONLY the problems identified in the narrative critique. Do not touch anything else.

---

## Input

- `LEVEL_COMPLETE.md` — the script
- `NARRATIVE_CRITIQUE.yaml` — the critique identifying specific problems

## Output

- `LEVEL_COMPLETE.md` — updated in place with fixes applied
- `CRITIQUE_FIXES.yaml` — diff log of every change and every skip

```yaml
critique_fixes:
  applied:
    - id: "XX-N"
      section: int
      before: "exact original text"
      after: "exact replacement text"
      category: "meta_narration | repeated_info | and_then | forward_ref"

  skipped:
    - id: "XX-N"
      reason: "intentional cold opener | intentional callback | structural (not fixable at prose level) | cannot fix without adding facts"
      category: string
```

---

## Rules (NON-NEGOTIABLE)

1. **Fix ONLY problems in the critique.** If it's not flagged, don't touch it.
2. **Do NOT add new facts, claims, or evidence.** If a fix requires inventing information, skip it.
3. **Do NOT remove evidence citations** `[PB_XX]`.
4. **Do NOT remove or modify protected markers** `::weight::`, `::tease::`, `::collapse::`.
5. **Do NOT change section headers.**
6. **Prefer cutting over adding.** If a fix requires adding words, you're probably doing it wrong. Cut, reorder, or rephrase existing words.
7. **Stay within 5% of original word count.** Cuts and additions should roughly balance.
8. **Skip items marked `intentional: true`** in the critique. These are deliberate techniques (cold openers, forward pull teases, callbacks).
9. **Skip energy dips.** These are structural and cannot be fixed at the prose level.

---

## Fix Patterns by Category

### Meta-narration
- "Here is the part that..." → cut the meta phrase, start with the claim directly
- "So now we know..." → replace with a direct restatement without "we know"
- "As we'll see..." → cut entirely

### Repeated information
- Keep the first occurrence, cut or rephrase the second
- If the second is in a tease or weight line, rephrase rather than cut

### "And then" transitions
- "X happened. Then Y happened." → "X happened. But Y..." or "X happened. Therefore Y..."
- Reword the connecting language to create a causal or contrastive link
- Do NOT restructure sections — just fix the connecting words

### Forward references (non-intentional only)
- If the reference can be cut without losing meaning, cut it
- If it can't be cut, add a minimal gloss (1-3 words max) that gives just enough context
