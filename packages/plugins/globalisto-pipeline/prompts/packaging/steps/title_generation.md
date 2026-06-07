<!-- DEPRECATED: This prompt was replaced by the title-first architecture. See angle_generation phase. -->

# TITLE + THUMBNAIL GENERATION (Step 2 of YouTube Module)

## PURPOSE

Generate a wide field of title candidates across multiple creative angles, score them, identify the winning angle, then create variations. Output title groups organized by frame for downstream thumbnail generation.

---

## THE CORE CONSTRAINTS

**Alignment:** "Would a reasonable viewer feel misled if this title led them to the video?"

**Recognition:** "Would a general viewer recognize the proper nouns in this title?"

These are the two HARD GATES. Titles must pass both before scoring. Everything else informs ranking.

---

## INPUTS

| Input | Source |
|-------|--------|
| `core_promise` | Step 1.5 output |
| `_COMPETITOR_SCAN.yaml` | Step 1 output (with breakout analysis) |
| `angle_summary` | phase_3B_angle_decision.md |
| `video_class` | phase_3B_angle_decision.md |
| `NARRATIVE_BLUEPRINT.md` | phase_5 |
| `POLISHED_SCRIPT.md` | phase_10 |

**PRE-CONDITION:** core_promise.validation_status must be PASSED or PASSED_WITH_AUTO_FIX.

---

## STEP 1: Review Competitive Intelligence

Before generating, extract insights from `_COMPETITOR_SCAN.yaml`:

**Breakout Videos (high watch:subscriber ratio):**
| Title | Views:Subs | Formula | Why It Worked |
|-------|------------|---------|---------------|
| [from scan] | [ratio] | [pattern] | [insight] |
| ... | | | |

**Patterns to Mirror:** (top 2-3 formulas from breakouts)
1. [formula + example]
2. [formula + example]

**Patterns to Avoid:** (overused in niche)
- [pattern] — [why oversaturated]

**Gaps Identified:** (angles competitors missed)
- [gap 1]
- [gap 2]

---

## STEP 2: Multi-Angle Title Generation

Generate **50 titles** across **10 angles** (5 titles per angle).

All titles must pass the core constraint: viewer would not feel misled.

### Angle 1: Core Promise (2 titles)
Direct expression of what the video delivers. Anchored to primary subject.

| # | Title | Formula Used |
|---|-------|--------------|
| 1 | | |
| 2 | | |

### Angle 2: Tension/Surprise (2 titles)
Expectation vs reality. Gap between what audience assumes and what's true.

| # | Title | Tension Pattern |
|---|-------|-----------------|
| 3 | | [expectation violated / status reversal / insider admission] |
| 4 | | |

### Angle 3: Personal Stakes (2 titles)
"You/Your" framing. Direct relevance to viewer's life.

| # | Title | Stakes Type |
|---|-------|-------------|
| 5 | | [threat / opportunity / identity] |
| 6 | | |

### Angle 4: Villain (2 titles)
Who's responsible. Who profits. Who's to blame.

| # | Title | Villain |
|---|-------|---------|
| 7 | | [person / company / system] |
| 8 | | |

### Angle 5: Mechanism (2 titles)
How it works. The system. The hidden process.

| # | Title | Mechanism Revealed |
|---|-------|-------------------|
| 9 | | |
| 10 | | |

### Angle 6: Comparison (2 titles)
X vs Y. David vs Goliath. Surprising winner.

| # | Title | Comparison Frame |
|---|-------|------------------|
| 11 | | [underdog / reversal / numbers] |
| 12 | | |

### Angle 7: Origin/Attribution (2 titles)
Who started this. Who invented it. Who saw it coming.

| # | Title | Attribution |
|---|-------|-------------|
| 13 | | [person / moment / decision] |
| 14 | | |

### Angle 8: Consequence (2 titles)
What happens next. Prediction. Inevitable outcome.

| # | Title | Consequence |
|---|-------|-------------|
| 15 | | |
| 16 | | |

### Angle 9: Curiosity Gap (2 titles)
Open loop. Withhold the answer. Create information gap.

| # | Title | What's Withheld |
|---|-------|-----------------|
| 17 | | |
| 18 | | |

### Angle 10: Breakout Mirror (2 titles)
Directly modeled on top breakout formulas from competitor scan.

| # | Title | Breakout Formula Mirrored |
|---|-------|---------------------------|
| 19 | | [from Step 1 patterns to mirror] |
| 20 | | |

---

## STEP 3: Alignment Gate (BLOCKING)

**This step is a HARD GATE. Titles that fail are ELIMINATED, not flagged.**

Before scoring, ALL 50 titles must pass alignment check. This is delegated to DeepSeek for batch analysis.

### 3A: Alignment Check via DeepSeek

**Send to DeepSeek (`deepseek chat`)** with this prompt:

```
You are checking YouTube titles for alignment with video content.

THE CORE QUESTION: "Would a reasonable viewer feel misled if this title led them to the video?"

A title FAILS if:
- It promises content the video doesn't deliver
- It emphasizes a secondary element as if it were the primary subject
- It makes claims not supported by the script
- It implies a comparison, confrontation, or event that doesn't occur in the video

INPUTS:
- Primary subject: [from core_promise]
- Core tension: [from core_promise]
- What the video actually covers: [summary of POLISHED_SCRIPT sections]

TITLES TO CHECK:
[list all 50 titles, numbered]

OUTPUT FORMAT (YAML):
```yaml
alignment_check:
  passed: [list of title numbers that PASS]
  failed:
    - id: [number]
      title: "[title]"
      reason: "[specific reason why it would mislead]"
```

Be strict. If there's doubt, fail it.
```

### 3B: Process Alignment Results

**BLOCKING RULE:** Do NOT proceed to scoring until alignment check returns.

1. Review DeepSeek's output
2. **ELIMINATE** all titles marked as failed
3. Note eliminated titles in generation_log.alignment_failures
4. Only PASSED titles proceed to Step 4 (Scoring)

**If more than 40 titles fail:** STOP. The title generation has systemic alignment problems. Review core_promise and regenerate.

---

## STEP 3.5: Recognition Gate (BLOCKING)

**This step is a HARD GATE. Titles with unrecognizable names are UPGRADED or ELIMINATED.**

Person names are the #1 cause of failed YouTube titles. Most viewers don't know who "Andy Jassy" or "Oliver Blume" is. This check MUST be delegated to DeepSeek to prevent rationalization.

### 3.5A: Recognition Check via DeepSeek

**Send to DeepSeek (`deepseek chat`)** with this prompt:

```
You are checking YouTube titles for RECOGNITION — whether viewers will know the proper nouns used.

RECOGNITION TIERS:
- T1 (Universal - 90%+ of general audience knows): Elon Musk, Jeff Bezos, Donald Trump, China, Germany, Apple, Tesla, Google
- T2 (Category - 70%+ of interested audience knows): Meta, Amazon, Microsoft, BMW, Porsche, Toyota, Netflix, Disney
- T3 (Insider - <30% know without context): ANY CEO name except Musk/Bezos, ANY executive name, technical terms (CARIAD, Nürburgring), historical business figures (Jack Welch)

CRITICAL RULE: Most CEO names are T3, not T2. Test: "Would my non-tech-interested parent recognize this name?" If no → T3.

T3 EXAMPLES (these are NOT universally known):
- Andy Jassy (Amazon CEO) → T3
- Sundar Pichai (Google CEO) → T3
- Tim Cook (Apple CEO) → T3 (borderline, but not Musk-level)
- Satya Nadella (Microsoft CEO) → T3
- Mark Zuckerberg → T2 (exception: Facebook drama made him known)
- Jack Welch (former GE CEO, died 2020) → T3
- Oliver Blume (VW CEO) → T3

TITLES TO CHECK:
[list all titles that passed alignment, numbered]

FOR EACH TITLE:
1. Identify any T3 proper nouns (especially person names)
2. If T3 noun found:
   - Provide a T2 UPGRADE that replaces the name with role/company
   - Example: "Andy Jassy" → "Amazon's CEO"
   - Example: "Jack Welch" → "GE's Former CEO" or "The Man Who..."
3. If no good upgrade exists (the name IS the hook), mark as FAIL

OUTPUT FORMAT (YAML):
```yaml
recognition_check:
  passed_unchanged: [list of title numbers with no T3 issues]
  upgraded:
    - id: [number]
      original: "[original title]"
      t3_noun: "[the unrecognizable name/term]"
      upgraded: "[new title with T2 replacement]"
  failed:
    - id: [number]
      title: "[title]"
      t3_noun: "[unrecognizable element]"
      reason: "[why no upgrade works]"
```

Be strict. If in doubt about recognition, upgrade it.
```

### 3.5B: Process Recognition Results

**BLOCKING RULE:** Do NOT proceed to scoring until recognition check returns.

1. Review DeepSeek's output
2. **REPLACE** original titles with upgraded versions
3. **ELIMINATE** titles marked as failed
4. Note changes in generation_log.recognition_upgrades
5. Only PASSED/UPGRADED titles proceed to Step 4 (Scoring)

**Example upgrades:**
| Original | T3 Noun | Upgraded |
|----------|---------|----------|
| "The $212 Million Reason Andy Jassy Fires People" | Andy Jassy | "The $212 Million Reason Amazon's CEO Fires People" |
| "How Jack Welch Invented Mass Layoffs" | Jack Welch | "How One CEO Invented Mass Layoffs" |
| "Oliver Blume: 'The Business Model No Longer Works'" | Oliver Blume | "VW's CEO: 'The Business Model No Longer Works'" |

---

## STEP 3.6: Promise Match Gate (BLOCKING)

**This gate checks: Does the title attract the RIGHT audience?**

A title can pass alignment (accurate) and recognition (known names) but still attract viewers who will bounce because the hook doesn't match the video's actual focus. A 90-second anecdote shouldn't sell a 14-minute thesis video.

### 3.6A: Promise Match Check via DeepSeek

**Send to DeepSeek (`deepseek chat`)** with this prompt:

```
You are checking YouTube titles for AUDIENCE FIT — whether the title attracts viewers who will be satisfied by the video's actual content.

THE CORE QUESTION: "Would someone who clicked this title stay engaged for a 14-minute video focused on [primary subject]?"

CONTEXT:
- Primary subject: [from core_promise.primary_subject]
- Video's one-sentence promise: [from core_promise.one_sentence]
- Question the video answers: [from core_promise.question_answered]
- Secondary elements (examples, evidence, anecdotes): [list from core_promise.secondary_elements]

TITLES TO CHECK:
[list all titles that passed alignment + recognition]

FOR EACH TITLE, determine:
1. Does it hook on the PRIMARY subject or a SECONDARY element?
2. What audience does this title attract? (What are they expecting?)
3. Would that audience stay for the video's actual focus?

CLASSIFICATION:
- PRIMARY HOOK: Title's main promise matches video's primary subject → PASS
- SECONDARY HOOK: Title leads with example/anecdote/evidence that appears briefly → FLAG
- MISMATCH: Title attracts audience wanting X, video delivers Y → FLAG

OUTPUT FORMAT (YAML):
```yaml
promise_match:
  passed: [title numbers that hook on PRIMARY subject]
  flagged:
    - id: [number]
      title: "[title]"
      hook_type: "secondary" or "mismatch"
      hooks_on: "[the secondary element or mismatched promise]"
      audience_expects: "[what clickers would want]"
      video_delivers: "[what video actually focuses on]"
      upgrade_possible: true/false
      suggested_upgrade: "[reframed title that hooks on primary]" or null
```

Be strict. If a title's main hook is a 90-second segment in a 14-minute video, flag it.
If the title would attract viewers wanting drama/conflict when the video delivers analysis/explanation, flag it.
```

### 3.6B: Process Promise Match Results

**BLOCKING RULE:** Do NOT proceed to scoring until promise match check returns.

1. Review DeepSeek's output
2. **UPGRADE** titles where suggested_upgrade is provided and improves fit
3. **ELIMINATE** titles with hook_type "secondary" or "mismatch" where no good upgrade exists
4. Note changes in generation_log.promise_match
5. Only PRIMARY HOOK titles proceed to Step 4 (Scoring)

**Example flags:**
| Title | Hook Type | Problem | Upgrade |
|-------|-----------|---------|---------|
| "Porsche Lost to Phone Company—20 Seconds" | secondary | Hooks on 90-sec Nürburgring segment | "17 Parts vs 200: Why German Engineering Doesn't Transfer" |
| "The Email Every Laid-Off Worker Has Seen" | secondary | Hooks on copycat memo evidence | "Why CEOs Copy Each Other's Layoffs" |

**If more than 30 titles fail:** The generated titles may be hooking on compelling-but-secondary elements. Review whether the primary subject has enough inherent tension, or whether angles need reframing.

---

## STEP 4: Diagnostic Scoring (Optional)

**The gates did the real work.** All titles that passed alignment, recognition, AND promise match are viable. Scoring is now OPTIONAL and diagnostic only.

### 4A: When to Score

Score only if you need to:
- Identify outliers (>20% below others = structurally weak, investigate)
- Compare similar titles to understand their differences
- Explain to stakeholders why certain titles work

**Do NOT use scoring to eliminate titles.** If a title passed all gates, it belongs in the final pool.

### 4B: Diagnostic Factors (if needed)

| Factor | What It Measures |
|--------|------------------|
| **Tension** | Expectation vs reality gap |
| **Specificity** | Number + Proper Noun + Concrete Verb |
| **Recognition** | T1/T2 terms only |
| **Personal Stakes** | You/Your, villain, entity |
| **Curiosity Gap** | Open loop strength |
| **Breakout Match** | Mirrors proven formula |

**Specificity elements:**
- NUMBER: percentage, dollar amount, count, time, ordinal (must be citable from script)
- PROPER NOUN: brand, person, place (not generic category like "German engineering")
- CONCRETE VERB: specific action, not vague (avoid: is dying, is failing, can't compete, is struggling)

---

## STEP 5: Generate Variations & Build Final Pool

### 5A: List All Gate-Passing Titles

All titles that passed alignment + recognition + promise match go into the candidate pool:

| # | Title | Angle | Notes |
|---|-------|-------|-------|
| | | | |

### 5B: Identify Strongest Frame for Variations

Pick ONE title to generate variations from (creator choice, or the one with clearest core frame). Extract:

- **Core frame:** [the central argument/insight]
- **Key tension:** [the expectation vs reality]
- **Specificity anchors:** [numbers, nouns, verbs that worked]

### 5C: Generate 4 Variations of Winning Angle

Create 4 NEW titles expressing the SAME core frame with different emphasis:

| Variation | Emphasis | Title |
|-----------|----------|-------|
| **Mechanism** | How it works | |
| **Villain** | Who profits/is responsible | |
| **System** | The broader pattern | |
| **Personal** | Direct stakes to viewer | |

**All variations must:**
- Express the same core tension as the winner
- Pass alignment check (viewer not misled)
- Use the same specificity anchors where possible

### 5D: Variation Alignment Gate (BLOCKING)

**Variations introduce NEW claims. They MUST pass alignment check before scoring.**

**Send to DeepSeek (`deepseek chat`)** with this prompt:

```
You are checking YouTube title VARIATIONS for alignment with video content.

THE CORE QUESTION: "Would a reasonable viewer feel misled if this title led them to the video?"

CONTEXT:
- Original winning title: [title that passed alignment]
- Primary subject: [from core_promise]
- What the video actually covers: [summary of POLISHED_SCRIPT sections]

VARIATIONS TO CHECK:
1. Mechanism: "[title]"
2. Villain: "[title]"
3. System: "[title]"
4. Personal: "[title]"

FOR EACH VARIATION, check:
- Does it make NEW claims not in the original title?
- Are those new claims supported by the video content?
- Would a viewer clicking this title find what they expect?

OUTPUT FORMAT (YAML):
```yaml
variation_alignment:
  passed: [list: "Mechanism", "Villain", etc.]
  failed:
    - variation: "[name]"
      title: "[title]"
      new_claim: "[what claim was added]"
      reason: "[why video doesn't support this claim]"
```

Be strict. Personal Stakes variations are HIGH RISK for adding unsupported claims like "Your [X] is next" or "This affects you" when the video doesn't make that connection.
```

**BLOCKING RULE:** Failed variations are ELIMINATED. Passed variations join the final pool.

### 5E: Assemble Final Pool

**All gate-passing titles + passed variations = Final Pool**

| # | Title | Angle | Source |
|---|-------|-------|--------|
| | | | [initial / variation] |
| | | | |
| | | | |

**This is your output.** All titles in the final pool are viable. Do NOT rank or eliminate based on scores.

**Only eliminate if:** A title is >20% weaker than others on diagnostic scoring AND you can identify a structural problem (not just "lower number"). This should be rare—if the gates worked, everything here is good.

---

## STEP 6: Group Titles by Frame

**Why group?** Multiple titles may express the same core frame. They should share a thumbnail concept. Generate thumbnails per GROUP, not per title.

### 6A: Grouping Rules

Titles belong in the SAME group if:
- Same angle (Core Promise, Tension, Villain, etc.)
- Variations of the same source title
- Express the same visual hook (e.g., "1981" titles all need a "year" visual)
- Within 20% of each other on diagnostic score (if scored)

### 6B: Create Groups

| Group | Frame | Titles |
|-------|-------|--------|
| A | [frame name, e.g., "Origin / 1981"] | [list titles] |
| B | [frame name] | [list titles] |
| C | [frame name] | [list titles] |

**Typical result:** 3-5 groups from a pool of 6-10 titles.

---


## STEP 7: Assemble Final Output

Output is organized by GROUP. Each group contains multiple title options (all viable). Thumbnails are generated in a separate downstream step.

### Output Format (repeat for each group)

**Group: "[frame name]"**
- **Titles:** [list all titles in group]
- **Shared visual hook:** [what connects these titles visually]

---

## STEP 8: Video Overview

From POLISHED_SCRIPT and NARRATIVE_BLUEPRINT:

- **Runtime:** [X:XX] (calculated from section timings)
- **Sections:**
  - S1: [name] — [0:00-X:XX]
  - S2: [name] — [X:XX-X:XX]
  - ...
- **Key moments:**
  - **Hook:** [opening line or moment]
  - **Turn:** [pivot moment]
  - **Climax:** [strongest reveal]

---

## OUTPUT FORMAT

```yaml
STEP3_TITLE_GROUPS:
  topic: "[topic_name]"
  video_class: "[detonator|mirror]"
  generated: "[date]"

  core_promise:
    # Passed through from Step 1.5
    video_type: "[single-focus | comparative | thematic | mystery]"
    one_sentence: "[what this video delivers]"
    primary_subject: "[specific entity]"
    question_answered: "[ends with ?]"
    core_tension: "[expectation] vs [reality]"

  competitor_insights:
    breakout_videos:
      - title: "[title]"
        views_to_subs: [ratio]
        formula: "[pattern]"
        insight: "[why it worked]"
    patterns_to_mirror:
      - "[formula 1]"
      - "[formula 2]"
    patterns_to_avoid:
      - "[oversaturated pattern]"
    gaps_identified:
      - "[unexplored angle]"

  final_pool:
    # Organized by FRAME/GROUP - each group shares a thumbnail
    # All titles passed alignment + recognition + promise match gates
    # NO RANKING within groups - all are viable for A/B testing

    groups:
      - frame: "[frame name, e.g., 'Origin / 1981']"
        shared_visual_hook: "[what connects these titles visually]"
        titles:
          - text: "[title 1]"
            angle: "[angle]"
            source: "[initial / variation]"
          - text: "[title 2]"
            angle: "[angle]"
            source: "[initial / variation]"

      - frame: "[next frame]"
        shared_visual_hook: "[what connects these titles visually]"
        titles:
          - text: "[title]"
            # ...

    note: "All titles in final_pool passed all gates. Pick from any group based on intuition or A/B test. Thumbnails generated in separate downstream step."

  video_overview:
    runtime: "[X:XX]"
    sections:
      - id: "S1"
        name: "[name]"
        time: "[0:00-X:XX]"
    key_moments:
      hook: "[opening]"
      turn: "[pivot]"
      climax: "[reveal]"

  generation_log:
    initial_titles_generated: 50
    angles_explored: 10
    breakout_formulas_mirrored: 2
    alignment_check:
      titles_passed: [N]
      titles_failed: [N]
      failures:
        - id: [N]
          title: "[title]"
          reason: "[why it failed]"
    recognition_check:
      titles_unchanged: [N]
      titles_upgraded: [N]
      titles_failed: [N]
      upgrades:
        - id: [N]
          original: "[original title with T3 name]"
          t3_noun: "[the unrecognizable name]"
          upgraded: "[new title with T2 replacement]"
      failures:
        - id: [N]
          title: "[title]"
          reason: "[why no upgrade worked]"
    promise_match:
      titles_passed: [N]
      titles_flagged: [N]
      flags:
        - id: [N]
          title: "[title]"
          hook_type: "[secondary/mismatch]"
          hooks_on: "[what it hooks on]"
          audience_expects: "[what clickers want]"
          video_delivers: "[actual focus]"
          action: "[upgraded/eliminated]"
          upgraded_to: "[new title]" or null
    titles_after_gates: [N]  # passed alignment + recognition + promise match
    variation_source:
      title: "[title used to generate variations]"
      core_frame: "[insight]"
      key_tension: "[expectation vs reality]"
    variations_generated: 4
    variation_alignment:
      passed: [list]
      failed:
        - variation: "[name]"
          reason: "[why it failed]"
    final_pool_size: [N]  # gate-passing titles + passed variations
    groups_created: [N]  # number of distinct frame groups
    note: "Titles grouped by frame. Each group has a shared visual hook. Pick any title from any group for A/B testing."
```

---

## ANTI-PATTERNS (What NOT to Do)

| Bad Pattern | Example | Why It Fails |
|-------------|---------|--------------|
| Promoting secondary element | "The Lincoln Electric Secret" when video is about Jack Welch | Viewers expect Lincoln, get Welch |
| Tangential angle | "Why Every CEO Uses the Same Script" for video about layoff origins | Doesn't match content |
| Clickbait disconnect | Shocking thumbnail of person who appears for 30 seconds | Promise ≠ delivery |
| Formula over substance | Forcing a pattern that doesn't fit | Accuracy > cleverness |
| Title-thumbnail mismatch | Serious title + humorous thumbnail | Confuses expectations |
| All vague titles | "German Engineering Is Dying" × 5 | No specificity, no differentiation |
| Ignoring breakout data | Not using competitor insights | Missing proven patterns |
| **Variation adding unsupported claims** | "Xiaomi Beat Porsche—Your BMW Is Next" when video doesn't connect Xiaomi to BMW | Variation introduced claim video doesn't make |
| **Skipping variation alignment check** | Scoring a high-scoring Personal Stakes variation without checking if claim is supported | High scores don't mean alignment passes |
| **Using T3 names without upgrade** | "The $212 Million Reason Andy Jassy Fires People" | Most viewers don't know who Andy Jassy is; use "Amazon's CEO" |
| **Rationalizing T3 as recognizable** | "Jack Welch is a business legend, everyone knows him" | No. He died in 2020. Use "GE's Former CEO" or "The Man Who..." |
| **Hooking on secondary element** | "Porsche Lost to Phone Company—20 Seconds" for video about German engineering paradigm shift | Attracts race drama audience; they bounce when video is industry analysis |
| **Prioritizing CTR over retention** | Choosing highest-tension title regardless of audience fit | Wrong audience clicks = high CTR, terrible retention, algorithm penalty |

---

## PRINCIPLES

1. **Wide then narrow** — Generate 50 across 10 angles, gates filter to viable pool
2. **Alignment is a hard gate** — Viewer must not feel misled; titles that fail are eliminated
3. **Recognition is a hard gate** — T3 names must be upgraded or eliminated; delegate to DeepSeek to prevent rationalization
4. **Promise match is a hard gate** — Title must attract the RIGHT audience; secondary hooks kill retention
5. **Gates > Scores** — If it passed all gates, it's viable. Scoring is diagnostic only.
6. **All gate-passers are options** — Don't artificially rank; let A/B testing decide
7. **Competitive intel drives angles** — Breakout patterns inform generation directly
8. **Title groups share visual hooks** — Thumbnails generated in dedicated downstream step
9. **Frame grouping enables thumbnail generation** — Groups with shared visual hooks feed into thumbnail step
10. **Variations need re-checking** — New claims introduced in variations must pass alignment

---

## MODEL SELECTION

| Task | Model | Rationale |
|------|-------|-----------|
| Title generation (all 50) | **Opus** | Creative work requires quality |
| **Alignment check (Step 3)** | **DeepSeek** | Batch analysis, objective criteria |
| **Recognition check (Step 3.5)** | **DeepSeek** | CRITICAL: Prevents Opus from rationalizing T3 names as "recognizable" |
| **Promise match (Step 3.6)** | **DeepSeek** | CRITICAL: Prevents Opus from rationalizing secondary hooks as "close enough" |
| Scoring (optional, diagnostic) | **Opus** | Only if investigating outliers |
| Variation generation | **Opus** | Creative work |
| **Variation alignment (Step 5D)** | **DeepSeek** | Batch analysis, objective criteria |

**WHY RECOGNITION MUST USE DEEPSEEK:**
Opus will rationalize. "Andy Jassy is the CEO of Amazon, surely people know him" — NO. Most viewers don't. The recognition check MUST be delegated to prevent this self-deception.

**WHY PROMISE MATCH MUST USE DEEPSEEK:**
Opus will rationalize. "The Xiaomi/Porsche moment IS in the video, so the title is fine" — NO. The question isn't whether it's accurate, it's whether the audience attracted by that hook will stay for a 14-minute industry analysis. A dramatic 90-second anecdote can be true AND still attract the wrong audience. Promise match MUST be delegated to prevent this conflation of accuracy with audience fit.
