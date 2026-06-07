# TRINITY GATE (Final Packaging Quality Gate)

## PURPOSE

Ensure title, thumbnail, and opening hook work as a unified package. A viewer encounters these three elements in sequence: thumbnail catches the eye → title gets read → hook keeps them watching. If any element contradicts, repeats, or undermines the others, the package fails. This gate catches misalignment before the package is finalized.

---

## INPUTS

| Input | Source |
|-------|--------|
| `YOUTUBE_PACKAGE.yaml` | Refined thumbnail + titles (from thumbnail refinement) |
| `THUMBNAIL_VARIATIONS.yaml` | Visual execution variants |
| Opening hook | From script/video overview (`video_overview.key_moments.hook`) |

---

## TEST 1: One-Sentence Promise

Write ONE sentence that describes what title + thumbnail + opening hook collectively promise the viewer.

**Rules:**
- Must be a single sentence. No "and also..." or semicolons smuggling in a second promise.
- Must be specific enough that a viewer could decide "yes I want this" or "no I don't."

**Examples:**

✅ PASS: "You'll find out how Sony went from dominating electronics to irrelevance."
- Title: "How Sony Lost Everything" → explains the arc
- Thumbnail: Sony logo cracking → shows the destruction
- Hook: "In 1999, Sony was worth more than Apple and Google combined" → establishes stakes

❌ FAIL: "You'll learn about Sony's history and also the broader consumer electronics market shifts and the role of leadership decisions."
- This is three promises. The package is unfocused.

❌ FAIL: Cannot write a coherent sentence.
- Title, thumbnail, and hook are pointing in different directions. REJECT.

**Verdict:** PASS / FAIL
- If FAIL: specify which element diverges and what it should align to.

---

## TEST 2: Complementarity Check

Each element must add UNIQUE information. Map what each contributes:

| Element | Information Contributed | Type |
|---------|----------------------|------|
| Thumbnail | [what visual info] | Visual |
| Title | [what text info] | Text |
| Hook | [what narrative info] | Audio/narrative |

**Scoring:**

- **Complementary**: Each element adds something the others can't. Thumbnail shows WHO/WHAT visually. Title explains the WHY/HOW in text. Hook establishes stakes/context. → ✅ PASS

- **Redundant**: Two or more elements convey the same information. E.g., thumbnail shows "Sony" + title says "Sony" + hook says "Sony." The viewer gets "Sony" three times and nothing else. → ❌ FAIL. Specify which elements overlap and what one of them should convey instead.

- **Contradictory**: Elements send conflicting signals. E.g., calm blue thumbnail + aggressive "DESTROYED" title. Peaceful visual + violent text = cognitive dissonance. → ❌ FAIL. Specify the contradiction.

**Verdict:** complementary / redundant / contradictory

---

## TEST 3: Emotional Register Match

Rate the energy/tone of each element:

| Element | Energy Level (1-10) | Tone | Emotion Evoked |
|---------|-------------------|------|---------------|
| Thumbnail | [1-10] | [e.g., dramatic, calm, shocking, mysterious] | [e.g., curiosity, fear, awe] |
| Title | [1-10] | [e.g., urgent, analytical, provocative] | [e.g., curiosity, outrage, wonder] |
| Hook | [1-10] | [e.g., conversational, intense, reflective] | [e.g., surprise, nostalgia, tension] |

**Rules:**
- Energy levels must be within 3 points of each other. Thumbnail at 9 + Title at 3 = FAIL.
- Tone doesn't need to be identical, but must be compatible. "Dramatic" thumbnail + "analytical" title = OK (creates intellectual drama). "Playful" thumbnail + "grave" title = FAIL (confusing).
- The dominant emotion should be consistent or build. Thumbnail evokes curiosity → title focuses curiosity → hook pays off curiosity = ✅.

**Verdict:** PASS / FAIL
- If FAIL: specify which element is mismatched and suggest adjustment.

---

## TEST 4: Scroll-Speed Glance Test

Simulate a viewer scrolling through YouTube at speed. They see the thumbnail for ~0.5 seconds.

Answer these questions:

1. **Does the thumbnail stop the scroll?** [yes/no]
   - What visual element catches the eye? If the answer is "nothing in particular" → FAIL.

2. **Does the thumbnail make the viewer read the title?** [yes/no]
   - The thumbnail should create a question or curiosity. The title should seem like it has the answer.
   - If the thumbnail is self-contained (viewer gets the full story from the image alone) → FAIL: no reason to read the title.
   - If the thumbnail is confusing (viewer can't figure out what it's about) → FAIL: viewer skips rather than investigates.

3. **Does the title make the viewer click?** [yes/no]
   - After seeing thumbnail + reading title, is the viewer compelled to watch?
   - If the title fully answers the thumbnail's question → FAIL: no reason to click.
   - If the title raises MORE questions → PASS: viewer needs to watch for answers.

**Verdict:** PASS / FAIL
- All 3 must be "yes" to pass. Specify which failed and why.

---

## GATE OUTPUT

```yaml
trinity_gate:
  date: "[YYYY-MM-DD]"
  group: "[frame name]"
  title_tested: "[winning title text]"
  thumbnail_tested: "[thumbnail visual description]"
  hook_tested: "[opening hook text]"

  one_sentence_promise:
    sentence: "[the unified promise]"
    verdict: "PASS|FAIL"
    failure_reason: "[if FAIL — which element diverges]"

  complementarity:
    thumbnail_adds: "[unique visual info]"
    title_adds: "[unique text info]"
    hook_adds: "[unique narrative info]"
    verdict: "complementary|redundant|contradictory"
    failure_reason: "[if not complementary — what overlaps or conflicts]"

  emotional_register:
    thumbnail_energy: [1-10]
    title_energy: [1-10]
    hook_energy: [1-10]
    tone_compatible: true|false
    verdict: "PASS|FAIL"
    failure_reason: "[if FAIL — which element is mismatched]"

  glance_test:
    stops_scroll: true|false
    drives_to_title: true|false
    drives_to_click: true|false
    verdict: "PASS|FAIL"
    failure_reason: "[if FAIL — which step breaks]"

  overall_verdict: "PASS|FAIL"
  failures: ["[list of specific failures]"]
  recommended_fixes: ["[specific actionable fixes if FAIL]"]
```

---

## ON FAILURE

If overall verdict is FAIL:

1. Identify which element(s) need adjustment (thumbnail, title, or hook)
2. Generate specific fix recommendations (not vague — "increase thumbnail contrast" not "make it better")
3. Route back to the appropriate step:
   - Thumbnail issue → back to `thumbnail_refinement.md`
   - Title issue → back to title generation gates
   - Hook issue → flag for script revision
4. Maximum 2 loops through the trinity gate. After 2 failures, escalate to human review with all gate results attached.

## HARD CONSTRAINTS

- ALL 4 tests must pass for overall PASS
- The one-sentence promise MUST be writable in a single sentence — no exceptions
- Emotional register variance must be ≤ 3 points between any two elements
- Maximum 2 retry loops before human escalation

## COMPLETION RULE

Done when: All groups in YOUTUBE_PACKAGE.yaml pass the trinity gate, or have been escalated after 2 failed loops.

## NEXT STEP

`YOUTUBE_PACKAGE.yaml` (trinity-gated) → `steps/description_generation.md`
