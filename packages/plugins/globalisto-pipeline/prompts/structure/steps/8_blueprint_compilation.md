# BLUEPRINT COMPILATION (Step 8)

## PURPOSE

Compile `STRUCTURE_GRAPH.yaml` and `ENGAGEMENT_STRATEGY.yaml` into the formats expected by downstream modules (Writing, Packaging).

This is a **mechanical transformation** - no editorial judgment required. The output must be writer-ready with no interpretation needed.

---

## INPUTS

| Input | Source |
|-------|--------|
| `STRUCTURE_GRAPH.yaml` | Step 7 output |
| `ENGAGEMENT_STRATEGY.yaml` | Step 3B output |
| `content_class` | Module input |
| `topic_name` | Module input |
| `medium` | Module input (default: `video`) |
| `ANGLE_LOCK.yaml` | Firm angle lock — structural constraint for the blueprint |

---

## OUTPUTS

Use the following delimiter format to separate the two output files:

```
--- FILE: BEAT_GRAPH.yaml ---
(content here)
--- FILE: BLUEPRINT.md ---
(content here)
```

### `BEAT_GRAPH.yaml`

Direct copy of `STRUCTURE_GRAPH.yaml`. The Writing module expects this filename.

```yaml
# Copy STRUCTURE_GRAPH.yaml content exactly
# No transformation needed - just rename
```

### `BLUEPRINT.md`

Human-readable markdown combining structure and engagement for downstream modules.

---

## COMPILATION PROCEDURE

### Step 1: Create BEAT_GRAPH.yaml

```
1. Read STRUCTURE_GRAPH.yaml
2. Write to BEAT_GRAPH.yaml (exact copy)
3. Verify file exists
```

### Step 2: Compile BLUEPRINT.md

**Extract loop and tease data per beat:**

1. For each beat, determine if it opens a loop (check ENGAGEMENT_STRATEGY.forward_pull.loops)
2. For each beat, determine if it closes a loop (check where loop.closes_at matches beat)
3. For each beat that opens a loop, extract the tease text pointing to closure
4. For close loop beats, extract the opening phrase for callback instruction

**Format as structured instructions:**

```markdown
# NARRATIVE BLUEPRINT
# [topic_name]
# Output: [YouTube Video Script | Article | Web Page] (based on medium)
# Content Class: [detonator|mirror]
# Target Duration: [X] seconds
# Generated: [YYYY-MM-DD]

---

## LOCKED ANGLE

**LOCKED ANGLE: [title from ANGLE_LOCK.yaml] — [one_sentence_promise from ANGLE_LOCK.yaml]**

The blueprint's narrative arc must serve this title's promise. Every section, loop, and payoff builds toward delivering this locked angle.

---

## VIDEO OVERVIEW

- **Content Class:** [detonator|mirror]
- **Total Sections:** [count from STRUCTURE_GRAPH]
- **Target Duration:** [X seconds]
- **Engagement Engine:** [from ENGAGEMENT_STRATEGY.engine]

---

## SECTION 1 TEMPLATE (HOOK WINDOW)

When compiling BEAT_01, use this format instead of the standard template:

### SECTION 1: [Beat Name]

**HOOK WINDOW (0:00-0:30):**

**MANDATORY STRUCTURE:**
1. **THE NUMBER/FACT:** [Primary evidence hook - one line]
2. **THE DEFINITION:** [What it means - one line]
3. **THE IMPLICATION:** [Why it's shocking - one line]
4. **THE TEASE:** [Forward pull to main loop closure]

**LOOP:** OPEN L_MAIN - question planted implicitly by the fact, NOT stated explicitly

**EVIDENCE:** [PRIMARY ONLY - list single evidence ID]

**DO NOT:**
- State the loop question explicitly ("How did...?")
- Include supporting evidence (move to Section 2)
- Mention documents, pages, or sources
- Provide historical context or backstory
- Use PROBLEM→CONSEQUENCE→RESOLUTION pattern

**PATTERN:** HOOK → TEASE (not PCRT)

---


## FINAL SECTION TEMPLATE (LANDING)

When compiling the LAST beat in the structure, use this format:

### SECTION [N]: [Beat Name]

**LANDING (final 10-15 seconds):**

**STRUCTURE OPTIONS:**

Option A - End on resolution (if this beat closes main loop):
1. **THE WEIGHT:** Final fact lands with impact
2. **THE CALLBACK:** Optional one-line reference to hook
3. [End screen begins]

Option B - Epilogue (if resolution was previous beat):
1. **THE NEW FACT:** One piece of new information only
2. **THE IMPLICATION:** What it means (one sentence)
3. [End screen begins]

**LOOP:** CLOSE L_MAIN (if not already closed)

**EVIDENCE:** Maximum 1 evidence ID - no stacking

**ABSOLUTELY DO NOT:**
- Restate the thesis or main argument
- Summarize what was covered
- Use "in conclusion", "to wrap up", "as we've seen"
- Recap evidence from earlier sections
- Add historical context or backstory
- Introduce new characters with setup
- Build to a "profound" final line
- Use PROBLEM→CONSEQUENCE→RESOLUTION pattern

**PATTERN:** WEIGHT → OUT (not PCRT)

---

## SECTION INSTRUCTIONS

[For each beat in STRUCTURE_GRAPH, in order:]

### SECTION [N]: [Beat Name]

**LOOP ACTION:** [Exactly one of the following]
- "**OPEN LOOP [ID]:** Plant question - '[question text from loop.question]'" (if beat opens a loop)
- "**CLOSE LOOP [ID]:** Answer the question from Section [X]. Callback to '[phrase from loop opening section]'." (if beat closes a loop)
- "[No loop action]" (if beat neither opens nor closes a loop)

**TEASE:** [Exactly one of the following]
- "**TEASE TOWARD SECTION [X]:** Forward pull - '[tease text from tease_points array]'" (if beat has associated tease)
- "[No tease]" (if no tease for this section)

**ARC PHASE:** [INTRIGUE|DISCOMFORT|RECOGNITION|COLLAPSE|WEIGHT]
**EMOTIONAL FUNCTION:** [from beat.emotional_function in STRUCTURE_GRAPH]
**CONTENT FOCUS:** [brief description from beat.content_focus or beat summary]

**EVIDENCE:**
- Primary: [EV_XXX] - [brief claim from evidence]
- Supporting: [EV_XXX], [EV_XXX]

**CHAIN:** [For tension beats only - from beat.chain if present]
- PROBLEM: [text]
- CONSEQUENCE: [text]
- RESOLUTION: [text]
- NEW_TENSION: [text]

---

[Continue for all sections]

---

## END BEHAVIOR

- **Strategy:** [detonator|mirror from content_class]
- **Main Loop Closes At:** Section [N]
- **Final Instruction:** [from end_behavior.type and description]
- **Forbidden Phrases:** [list from end_behavior if present]

---

*Blueprint ready for writing execution. No interpretation required.*
```

---

## EXECUTION

```
STEP: Structure Step 8 - Blueprint Compilation
═══════════════════════════════════════════════════════════
REQUIRES: STRUCTURE_GRAPH.yaml, ENGAGEMENT_STRATEGY.yaml
CHECKING: STRUCTURE_GRAPH.yaml ... EXISTS
CHECKING: ENGAGEMENT_STRATEGY.yaml ... EXISTS
PROCEEDING: YES

1. Copy STRUCTURE_GRAPH.yaml → BEAT_GRAPH.yaml
2. Read STRUCTURE_GRAPH.yaml for beat data
3. Read ENGAGEMENT_STRATEGY.yaml for engagement data
4. Compile BLUEPRINT.md using template above
5. Write BLUEPRINT.md

───────────────────────────────────────────────────────────
COMPLETED: Structure Step 8 - Blueprint Compilation
SAVED: BEAT_GRAPH.yaml
SAVED: BLUEPRINT.md
NEXT: Writing Module Step 0 - Quote Injection Prep
NEXT REQUIRES: RESEARCH_MASTER.yaml
───────────────────────────────────────────────────────────
```

---

## MODEL SELECTION

| Model | When to Use |
|-------|-------------|
| **DeepSeek (Recommended)** | Default - mechanical transformation |
| Opus | Not needed for this step |

This step requires no editorial judgment - it's pure data transformation.

---

## VALIDATION

After compilation, verify:

- [ ] BEAT_GRAPH.yaml exists and matches STRUCTURE_GRAPH.yaml content
- [ ] BLUEPRINT.md exists
- [ ] BLUEPRINT.md includes LOCKED ANGLE header with title and one_sentence_promise from ANGLE_LOCK.yaml
- [ ] All sections from STRUCTURE_GRAPH appear in blueprint
- [ ] Loop actions are explicit per section (OPEN LOOP / CLOSE LOOP / No loop action)
- [ ] Tease instructions are explicit per section (TEASE TOWARD / No tease)
- [ ] Close loop sections include callback instruction with phrase reference
- [ ] No separate "Tease Points" or "Supporting Loops" sections present
- [ ] Content class and topic name are correct
- [ ] All instructions are writer-ready with no interpretation needed
