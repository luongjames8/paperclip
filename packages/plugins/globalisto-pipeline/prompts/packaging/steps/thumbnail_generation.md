# THUMBNAIL GENERATION (Step 2b of YouTube Module)

## PURPOSE

Generate thumbnail concepts that pass the **120px test** — instantly comprehensible at the smallest size YouTube displays them. This step runs AFTER title generation gates AND the cross-niche thumbnail scan.

**The #1 failure mode:** generating editorial illustrations (magazine covers, abstract metaphors) instead of YouTube thumbnails. Every concept must survive being shrunk to a tiny square on a phone screen while someone scrolls at full speed.

---

## INPUTS

| Input | Source |
|-------|--------|
| `STEP3_title_groups.yaml` | Step 2 output (title groups with frames) |
| `STEP1_promise.yaml` | Step 1.5 output (core promise) |
| `STEP2_competitors.yaml` | Step 1 output (competitor thumbnail patterns) |
| `CROSS_NICHE_REFERENCE.yaml` | Cross-niche scan (novel visual patterns from outside niches) |

---

## STEP 1: Review Inputs

Read and extract:

**From STEP3_title_groups.yaml:**
- All title groups (frame + titles)
- Video class (detonator or mirror)

**From STEP1_promise.yaml:**
- `primary_subject`
- `core_tension`

**From STEP2_competitors.yaml:**
- `thumbnail_patterns.dominant_compositions` — what competitors do (DIFFERENTIATE from this)
- `visual_hooks_available` — visual elements from our content

**From CROSS_NICHE_REFERENCE.yaml:**
- `cross_niche_patterns` — ranked novel patterns from outside niches
- At least ONE pattern from this list MUST be used or adapted

---

## STEP 2: Generate Thumbnails Per Group

For each GROUP in STEP3_title_groups.yaml, generate thumbnail concepts using the prompt below.

### Thumbnail Generation Prompt

~~~
You are a YouTube thumbnail concept generator. Your job is to create concepts that a viewer INSTANTLY understands while scrolling at full speed on a phone.

## HARD RULES — Apply to EVERY concept. No exceptions.

1. **120px test**: Describe this thumbnail at 120px wide. If the description is "a dark blur," "an unidentifiable shape," or "you'd need to squint" → REJECT. Try again.

2. **Glance test (under 1 second)**: A viewer scrolling at full speed must understand what they're looking at in under 1 second. If it requires ANY interpretation → REJECT.

3. **One focal element**: Maximum ONE thing to look at. Not a metaphor. Not a symbol. A THING.
   - ✅ PASS: A Sony logo cracking in half
   - ✅ PASS: A Tesla on fire
   - ✅ PASS: Jeff Bezos looking shocked
   - ❌ FAIL: A calculator with one key dripping blood (requires interpretation)
   - ❌ FAIL: Gold bars casting a shadow that morphs into a prison cell (too complex)
   - ❌ FAIL: A hand pulling a thread from a corporate tapestry (abstract metaphor)

4. **No abstract metaphors**: The viewer must understand the image LITERALLY, not symbolically. "Logo breaking apart" = literal, instant. "Calculator dripping blood" = symbolic, requires thought. If you have to explain what the image MEANS → REJECT.

5. **Emotion must be readable at thumbnail size**: If there's a face, the emotion (shock, fear, anger, joy) must be obvious at 120px. If there's an object, its state (broken, glowing, enormous, tiny) must be obvious at 120px.

6. **High contrast**: The focal element must visually POP against the background. Dark subject on dark background = invisible at small size. The focal element needs a contrasting background or rim lighting.

7. **Complementary to title**: The thumbnail shows WHAT. The title explains WHY. They must add different information. If the thumbnail just visualizes the title words → REJECT.

## CONTEXT
- Channel: Business/economics essays (10-15min)
- Audience: Professionals 25-50, curious about corporate systems
- Style: Bold, immediate, high-contrast (not editorial, not magazine-cover)

## TITLES (share ONE thumbnail)
[list all titles in the group]

## CORE STORY
- Subject: [from STEP1_promise.yaml primary_subject]
- Tension: [from STEP1_promise.yaml core_tension]

## CROSS-NICHE PATTERNS (must use at least ONE)
[list top 3-5 patterns from CROSS_NICHE_REFERENCE.yaml with descriptions and application hints]

## COMPETITIVE INTELLIGENCE
- What competitors do: [from STEP2_competitors.yaml thumbnail_patterns.dominant_compositions]
- What to avoid: [patterns that are saturated in the ecosystem]
- Visual hooks from our content: [from STEP2_competitors.yaml visual_hooks_available]

## COMPOSITION TYPES

Pick one. Each type has a specific reason it works at small size:

### BRAND DESTRUCTION
A recognizable brand element (logo, product, building) visibly damaged, breaking, dissolving, or crumbling. Works because brand logos are recognizable at ANY size, and destruction is instantly readable.
- Example: Sony logo cracking apart on black background
- Example: Nokia phone shattering into pieces
- Example: Blockbuster sign with letters falling off
- When to use: Video is about a brand's failure, decline, or crisis

### DRAMATIC FACE
A universally recognizable person with an extreme, readable emotion. Works because humans process faces faster than any other visual. The emotion creates instant curiosity.
- Example: Elon Musk looking genuinely shocked/worried
- Example: Mark Zuckerberg with a frozen smile (uncanny)
- When to use: Video features a T1 recognizable figure (Musk, Bezos, Zuckerberg, etc.)
- CONSTRAINT: Only use faces recognizable to 80%+ of the target audience. Random CEO = ❌

### OBJECT TRANSFORMATION
A familiar everyday object in an impossible, wrong, or dramatically altered state. Works because the brain instantly flags "that's not right" — creating a curiosity gap.
- Example: A McDonald's golden arch melting like wax
- Example: An iPhone with a cracked screen showing a stock chart going to zero
- Example: A grocery cart overflowing with cash instead of groceries
- When to use: Video is about a system/product/industry behaving unexpectedly

### SCALE SHOCK
Something rendered at an impossibly large or small scale to create immediate visual surprise. Works because scale violation is processed pre-consciously — you don't think about it, you just notice.
- Example: A tiny person standing next to an enormous price tag
- Example: A building-sized Amazon box crushing a neighborhood
- When to use: Video involves shocking numbers, market dominance, or hidden scale

### BEFORE/AFTER SPLIT
Two states of the same thing shown side by side, demonstrating dramatic change. Works because comparison is instant — no interpretation needed.
- Example: Left side: gleaming Apple store. Right side: same store dark and abandoned.
- Example: Left side: stock chart up. Right side: same chart crashed.
- When to use: Video is about transformation, decline, or dramatic change over time

## OUTPUT (per group — generate 3 concepts, pick 1 winner)

For each concept:

| # | Composition Type | Visual Description | Focal Point | Text Overlay (≤4 words or none) | Complements Title By... |
|---|-----------------|-------------------|-------------|--------------------------------|------------------------|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

### 120px Simulation Check (REQUIRED for each concept)

For each of the 3 concepts, answer:
> "At 120px wide, a viewer sees: [describe what is literally visible]"
> If the answer is vague or requires squinting → REJECT and regenerate.

### Cross-Niche Pattern Used
> "Concept [N] adapts the [pattern name] pattern from [source niche]: [1 sentence how]"

### Winner Selection
> "**Winner: Concept [N]** — [1 sentence why it beats the others at thumbnail size]"
~~~

---

## STEP 3: Assemble Output

Merge thumbnail data back into the title groups to produce YOUTUBE_PACKAGE.yaml. Each group gains a `thumbnail` block.

### Output: YOUTUBE_PACKAGE.yaml

The output preserves ALL data from STEP3_title_groups.yaml and adds thumbnail data to each group:

```yaml
YOUTUBE_PACKAGE:
  topic: "[topic_name]"
  video_class: "[detonator|mirror]"
  generated: "[date]"

  core_promise:
    # Passed through from STEP1_promise.yaml
    video_type: "[single-focus | comparative | thematic | mystery]"
    one_sentence: "[what this video delivers]"
    primary_subject: "[specific entity]"
    question_answered: "[ends with ?]"
    core_tension: "[expectation] vs [reality]"

  competitor_insights:
    # Passed through from STEP2_competitors.yaml
    breakout_videos: [...]
    patterns_to_mirror: [...]
    patterns_to_avoid: [...]
    gaps_identified: [...]
    thumbnail_patterns:
      dominant_compositions: [...]
      text_patterns: [...]
      color_schemes: [...]
    visual_hooks_available: [...]

  cross_niche_reference:
    # Passed through from CROSS_NICHE_REFERENCE.yaml
    patterns_used: ["[pattern names applied]"]
    source_niches: ["[niches referenced]"]

  final_pool:
    groups:
      - frame: "[frame name]"
        titles:
          - text: "[title]"
            angle: "[angle]"
            source: "[initial / variation]"
        thumbnail:
          composition_type: "[BRAND_DESTRUCTION | DRAMATIC_FACE | OBJECT_TRANSFORMATION | SCALE_SHOCK | BEFORE_AFTER_SPLIT]"
          visual: "[description]"
          focal_point: "[the ONE thing the viewer sees]"
          text_overlay: "[≤4 words or 'none']"
          works_because: "[why this thumbnail works for all titles in group]"
          cross_niche_pattern: "[which cross-niche pattern was adapted, if any]"
          simulation_120px: "[what a viewer literally sees at 120px]"

    note: "All titles in final_pool passed all gates. Pick from any group based on intuition or A/B test."

  video_overview:
    runtime: "[X:XX]"
    sections: [...]
    key_moments:
      hook: "[opening]"
      turn: "[pivot]"
      climax: "[reveal]"

  generation_log:
    thumbnails_generated: "[N]"
    thumbnail_groups: "[N]"
    cross_niche_patterns_used: ["[pattern names]"]
    concepts_rejected_120px_test: "[N]"
```

---

## PRINCIPLES

1. **120px or bust** — If it doesn't work at 120px, it doesn't work. Period. This overrides every other consideration.
2. **Literal beats symbolic** — A broken logo beats a metaphorical illustration every time. The viewer has zero seconds to interpret meaning.
3. **Complement, don't repeat** — Thumbnail shows WHAT. Title explains WHY. If you can understand both from the thumbnail alone, the title is redundant.
4. **Steal from other niches** — The most effective thumbnails in any ecosystem are patterns imported from elsewhere. Use the cross-niche reference data.
5. **One focal point** — If you can't describe the thumbnail in 5 words, it's too complex.
6. **Recognition constraint** — Only universally recognizable faces (T1). Any random CEO = ❌ unless Musk/Bezos/Zuckerberg level.
7. **High contrast is non-negotiable** — The focal element must pop. Test: would this be visible on a bright phone screen outdoors?

---

## MODEL SELECTION

| Task | Model | Rationale |
|------|-------|-----------|
| Thumbnail concept generation | **Opus** | Creative visual ideation with strict constraint adherence |
| 120px simulation check | **Opus** | Requires honest self-evaluation of visual clarity |
