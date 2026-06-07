# THUMBNAIL REFINEMENT (Post-Generation Quality Gate)

## PURPOSE

Take the winning thumbnail concept from generation and stress-test it through the 7-layer thumbnail DNA schema. Score scalability at three sizes. Check curiosity gap and title complementarity. If any check fails, loop back to generation with specific feedback. Output a fully specified thumbnail concept ready for the trinity gate.

---

## INPUTS

| Input | Source |
|-------|--------|
| `YOUTUBE_PACKAGE.yaml` | Thumbnail generation output (winning concepts per group) |
| `CROSS_NICHE_REFERENCE.yaml` | Cross-niche patterns (for alternative suggestions on failure) |

---

## STEP 1: DNA Decomposition

For each thumbnail concept in YOUTUBE_PACKAGE.yaml, decompose it into the 7-layer thumbnail DNA schema:

### Layer 1 — Subject
- `type`: [brand_element | person | object | scene]
- `identity`: [what specifically — "Sony logo", "Elon Musk", "melting golden arch"]
- `face_position`: [left | center | right | N/A]
- `emotion`: [surprise | joy | anger | fear | disgust | contempt | neutral | N/A]
- `emotion_intensity`: [1-10, where 10 = extreme]
- `eye_contact`: [direct | averted | N/A]

### Layer 2 — Composition
- `layout_type`: [centered-single | subject-left-text-right | split-comparison | rule-of-thirds | full-bleed]
- `shot_type`: [close-up | medium | wide | extreme-close-up]
- `visual_hierarchy`: [describe the 1-2-3 order the eye travels]
- `negative_space`: [percentage of image that is breathing room]

### Layer 3 — Color
- `dominant_colors`: [list with hex codes]
- `palette_type`: [high-contrast-complementary | monochromatic-accent | warm-dominant | cool-dominant]
- `saturation`: [high | medium | low]
- `contrast_ratio`: [estimated ratio between focal element and background]

### Layer 4 — Lighting
- `quality`: [dramatic | natural | flat | studio]
- `direction`: [front | side | back | rim | multiple]
- `subject_isolation_method`: [rim-light | vignette | blur | color-contrast | spotlight]

### Layer 5 — Text
- `word_count`: [0-4]
- `font_style`: [bold-sans | serif | handwritten | none]
- `text_content`: "[exact overlay text]"
- `readability_at_small_size`: [high | medium | low]
- `text_title_overlap`: [none | partial | full] — full = FAIL

### Layer 6 — Style
- `aesthetic`: [photorealistic | graphic | collage | illustration | mixed-media]
- `production_quality`: [premium | mid | raw]
- `consistency_markers`: [what makes this recognizable as part of the channel]

### Layer 7 — Quality Signals
- `curiosity_gap`: [true | false] — does the thumbnail create a question?
- `emotion_legibility`: [high | medium | low] — can you read the emotion at thumbnail size?
- `clutter_level`: [minimal | moderate | cluttered] — cluttered = FAIL
- `scalability`: scored below in Step 2

---

## STEP 2: Scalability Scoring

Rate each thumbnail concept at three display sizes:

### 1280px (Desktop full view)
- Can you see all detail? [yes/no]
- Does composition hold? [yes/no]
- Is text readable? [yes/no/N/A]
- Score: [1-10]

### 320px (Mobile browse)
- Is the focal element identifiable? [yes/no]
- Is the emotion/state readable? [yes/no]
- Does text remain legible? [yes/no/N/A]
- Score: [1-10]

### 120px (Suggested/sidebar)
- Can you identify WHAT this image is about? [yes/no]
- Is there one clear focal point? [yes/no]
- Would you understand this while scrolling at speed? [yes/no]
- Score: [1-10]

**GATE:** 120px score must be ≥ 7. If below 7 → FAIL with specific reason.

---

## STEP 3: Curiosity Gap Check

Answer these questions:

1. **Does the thumbnail create a question?**
   - What question does a viewer ask when seeing this thumbnail? Write it out.
   - If no clear question emerges → FAIL: "Thumbnail is descriptive, not curious"

2. **Does the title answer that question?**
   - The thumbnail should make you wonder. The title should make you click.
   - If the thumbnail already tells the whole story → FAIL: "No reason to read the title"

Example:
- Thumbnail: Sony logo cracking apart → Question: "What happened to Sony?"
- Title: "How Sony Lost Everything" → Answers the question. ✅ PASS.

Example fail:
- Thumbnail: Text saying "Sony Lost Everything" + sad emoji → No question, just a statement. ❌ FAIL.

---

## STEP 4: Complementarity Check

| Element | Information Added |
|---------|------------------|
| Thumbnail | [what visual information does it convey?] |
| Title | [what text information does it convey?] |
| Overlap | [what information appears in BOTH?] |

**Scoring:**
- **Complementary** (overlap ≤ 20%): Thumbnail and title each add unique information. ✅ PASS.
- **Redundant** (overlap > 50%): Thumbnail just illustrates the title. ❌ FAIL.
- **Contradictory**: Thumbnail and title send conflicting signals. ❌ FAIL.

---

## STEP 5: Pass/Fail Decision

| Check | Result | Details |
|-------|--------|---------|
| 120px scalability (≥7) | PASS/FAIL | [score and reason] |
| Curiosity gap | PASS/FAIL | [question generated or why not] |
| Complementarity | PASS/FAIL | [complementary/redundant/contradictory] |
| Clutter level (≠ cluttered) | PASS/FAIL | [minimal/moderate/cluttered] |
| Text-title overlap (≠ full) | PASS/FAIL | [none/partial/full] |

### If ANY check fails:

Generate a **feedback block** and loop back to thumbnail generation:

```yaml
refinement_feedback:
  failed_checks:
    - check: "[which check]"
      reason: "[specific reason]"
      suggestion: "[what to change — be specific]"
  alternative_patterns:
    - "[suggest a cross-niche pattern from CROSS_NICHE_REFERENCE.yaml that might fix this]"
  retry_constraints:
    - "[specific constraint for the retry, e.g., 'Use BRAND DESTRUCTION instead of OBJECT TRANSFORMATION']"
    - "[e.g., 'Increase contrast — use bright focal element on dark background']"
```

Maximum 2 refinement loops. If still failing after 2 loops, flag for human review.

### If ALL checks pass:

Proceed to output.

---

## OUTPUT

### Updated `YOUTUBE_PACKAGE.yaml` thumbnail block (per group)

Each group's thumbnail block is enriched with DNA data:

```yaml
thumbnail:
  composition_type: "[type]"
  visual: "[description]"
  focal_point: "[the ONE thing]"
  text_overlay: "[≤4 words or 'none']"
  works_because: "[1 sentence]"
  cross_niche_pattern: "[pattern name or 'none']"
  simulation_120px: "[what viewer sees at 120px]"

  thumbnail_dna:
    subject:
      type: "[brand_element | person | object | scene]"
      identity: "[specific element]"
      emotion: "[if applicable]"
      emotion_intensity: "[1-10]"
    composition:
      layout_type: "[type]"
      shot_type: "[type]"
      visual_hierarchy: "[1-2-3 order]"
    color:
      dominant_colors: ["[hex]", "[hex]"]
      palette_type: "[type]"
      contrast_ratio: "[estimated]"
    lighting:
      quality: "[type]"
      subject_isolation_method: "[method]"
    text:
      word_count: "[0-4]"
      readability_at_small_size: "[high|medium|low]"
    style:
      aesthetic: "[type]"
      production_quality: "[level]"
    quality_signals:
      curiosity_gap: true
      emotion_legibility: "[high|medium|low]"
      clutter_level: "[minimal|moderate]"
      scalability:
        at_1280px: "[1-10]"
        at_320px: "[1-10]"
        at_120px: "[1-10]"

  refinement_log:
    loops_required: "[0-2]"
    checks_failed_initial: ["[list]"]
    final_verdict: "PASS"
```

### Also output: `THUMBNAIL_VARIATIONS.yaml`

```yaml
locked_concept: "[winning thumbnail concept description]"
variations:
  - description: "[detailed visual execution 1]"
    key_element: "[what makes this version distinct]"
    text_overlay: "[text or 'none']"
    dna_adjustments: "[what DNA layers differ from base]"
  - description: "[detailed visual execution 2]"
    key_element: "[what makes this version distinct]"
    text_overlay: "[text or 'none']"
    dna_adjustments: "[what DNA layers differ from base]"
selected: null  # Human selects after review
```

---

## HARD CONSTRAINTS

- 120px scalability score ≥ 7 is non-negotiable
- Maximum 2 refinement loops before escalating to human
- Every thumbnail must have a curiosity gap — if it doesn't make you wonder, it won't make you click
- DNA decomposition must be complete (all 7 layers) — no skipping layers
- Complementarity must be "complementary" — redundant or contradictory thumbnails are rejected

## COMPLETION RULE

Done when: All thumbnail concepts in YOUTUBE_PACKAGE.yaml pass all 5 checks, DNA is fully specified, and THUMBNAIL_VARIATIONS.yaml is written.

## NEXT STEP

`YOUTUBE_PACKAGE.yaml` (refined) + `THUMBNAIL_VARIATIONS.yaml` → `steps/trinity_gate.md`
