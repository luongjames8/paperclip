# STEP 1: CONSTRAINED TITLE VARIATIONS

## PURPOSE
Generate 3-5 phrasing variations of the locked title. Same angle, same promise, different word choices. These are NOT new angles — they are alternative phrasings.

## INPUT
| Input | Source |
|-------|--------|
| `ANGLE_LOCK.yaml` | Firm angle lock |
| `POLISH_COMPLETE.md` | Polished script (for context) |

## PROCESS

1. Read the locked title from ANGLE_LOCK.yaml
2. Generate 3-5 phrasing variations:
   - Same core promise
   - Same recognizable names (T1/T2)
   - Different word order, synonyms, emphasis
   - Different title structures (question, statement, "How X", "Why X", "The X That Y")
3. For each variation, check:
   - Still 5-8 words?
   - Still contains T1/T2 names?
   - Still makes the same promise?

## OUTPUT
### `TITLE_VARIATIONS.yaml`
```yaml
locked_title: "[original locked title]"
variations:
  - title: "[variation 1]"
    word_count: 6
    structure: "How X"
  - title: "[variation 2]"
    word_count: 7
    structure: "The X That Y"
  - title: "[variation 3]"
    word_count: 5
    structure: "Why X"
selected: null  # Human selects after review
```

## HARD CONSTRAINTS
- Variations MUST preserve the locked angle — same promise, same names
- NO new angles or promises allowed
- Each variation MUST be 5-8 words
- Minimum 3 variations, maximum 5

## COMPLETION RULE
Done when: TITLE_VARIATIONS.yaml has 3-5 valid variations of the locked title.

## NEXT STEP
`TITLE_VARIATIONS.yaml` → `steps/thumbnail_refinement.md`
