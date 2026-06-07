# SCRIPT POLISH MODULE

## MODEL SELECTION

| Step | Model |
|------|-------|
| Language Smooth | Opus |

See `MODEL_SELECTION.md` for rationale.

---

## PURPOSE

Polish any written content for spoken delivery (YouTube, podcasts, presentations) or written consumption (websites, articles).

This module improves LANGUAGE ONLY. It does not change meaning, structure, or arguments.

---

## INPUTS

| Input | Required | Purpose |
|-------|----------|---------|
| `content.md` | Yes | Raw content to polish (markdown) |
| `reading_level` | No | `grade_6` \| `grade_9_10` (default) \| `grade_12` |
| `medium` | No | `youtube` (default) \| `podcast` \| `presentation` \| `website` \| `article` |
| `voice_style` | No | `punchy` \| `conversational` (default) \| `formal` |
| `structure_ref` | No | Optional file to verify no structural drift |

---

## MEDIUM BEHAVIORS

| Medium | Optimization Focus |
|--------|-------------------|
| `youtube` | Breath length, visual tags, punchy delivery, spoken rhythm |
| `podcast` | Natural flow, longer sentences OK, audio-only clarity |
| `presentation` | Slide transitions, formal tone, clear point structure |
| `website` | Short paragraphs, scannable, headers preserved |
| `article` | Flowing prose, narrative structure, longer form |

---

## OUTPUT

### `POLISHED_CONTENT.md`

The polished content with identical structure to input.

### `POLISH_REPORT.yaml`

```yaml
POLISH_REPORT:
  input_file: "[content.md]"
  medium: "[medium]"
  reading_level: "[level]"
  polished: "[date]"

  metrics:
    words_cut: 0
    sentences_tightened: 0
    filler_phrases_removed: 0
    visual_tags_added: 0  # youtube/presentation only
    impact_opportunities_flagged: 0

  structural_warnings:  # Issues found, NOT fixed
    - issue_type: "[type]"
      location: "[section + approximate position]"
      description: "[what's wrong]"
      recommendation: "[how to fix upstream]"

  impact_opportunities:  # Proposals for writer review
    - current: "[original text]"
      proposed: "[alternative with more impact]"
      reason: "[why this serves the content better]"

  confirmation:
    structure_changed: false
    meaning_changed: false
    claims_strengthened: false
    claims_weakened: false
    new_ideas_introduced: false
```

---

## EXECUTION

This module runs in one step:

### Step 1: Language Smooth
**Prompt:** `steps/language_smooth.md`

Polish the content according to reading level and medium requirements.

**Outputs:** `POLISHED_CONTENT.md`, `POLISH_REPORT.yaml`

---

## HARD CONSTRAINTS (NON-NEGOTIABLE)

This module may NOT:
- Add, remove, or reorder content/sections
- Introduce new ideas, facts, or examples
- Strengthen or weaken claims
- Change meaning or emphasis
- Move information between sections
- Fix structural issues (flag only)

This module may ONLY:
- Improve sentence clarity
- Simplify vocabulary (within reading_level)
- Optimize for medium (breath length, scannability, etc.)
- Remove filler/hedging where safe
- Vary sentence rhythm
- Flag issues for upstream fix

**If meaning would change, leave unchanged and flag it.**

---

## PRINCIPLES

1. Readability does not mean blandness - preserve voice
2. Hemingway is Grade 4 reading level - simplicity has punch
3. Log warnings, never fix structural issues
4. Impact opportunities are proposals, not automatic changes
5. When in doubt, leave unchanged
