<!-- DEPRECATED: This prompt was replaced by the title-first architecture. See angle_generation phase. -->

# CORE PROMISE EXTRACTION (Step 1.5 of YouTube Module)

## PURPOSE

Extract the core promise of the video BEFORE any title/thumbnail work begins. This ensures all packaging variations express the same central message—not tangential angles that hurt retention.

---

## INPUTS

| Input | Source |
|-------|--------|
| `NARRATIVE_BLUEPRINT.md` | phase_5 |
| `POLISHED_SCRIPT.md` | phase_10 |

**Input Conflict Resolution:**
- For CONTENT questions (what the video says): POLISHED_SCRIPT wins
- For STRUCTURE questions (section order): NARRATIVE_BLUEPRINT wins
- For SUBJECT questions: Use section-based measurement (see Step 1)

---

## THE CORE PRINCIPLE

**"Would a reasonable viewer feel misled if this title led them to the video?"**

Every title and thumbnail must be a variation on expressing the core promise. Not:
- Tangential angles
- Secondary elements promoted to primary
- "Interesting but different" ideas

---

## STEPS

### Step 1: Identify Video Type (Section-Based Measurement)

Use production_sections from BEAT_GRAPH.yaml (typically 3-4 sections) to classify objectively:

**PROCEDURE:**
1. Read production_sections from BEAT_GRAPH.yaml
2. For each production section, identify the PRIMARY ENTITY (person, company, or concept with highest mention frequency in beats within that section)
3. Tally which entity dominates each production section
4. Apply classification rules:

| If... | Then video_type = |
|-------|-------------------|
| ≥75% of production_sections focus on same entity | `single-focus` |
| 2+ entities each have ≥30% of production_sections | `comparative` |
| No entity reaches 30%, theme/question dominates | `thematic` |
| Answer/revelation withheld until final production_section | `mystery` |

**TIE-BREAKER RULES:**
- If two entities both have 40-50% of production_sections: classify as `comparative`
- If unclear between single-focus and thematic: count proper nouns vs abstract concepts in section summaries. More proper nouns → single-focus
- For videos with 3 production_sections: use word frequency in POLISHED_SCRIPT as primary measure

**Example (Layoffs video, 4 production_sections):**
| Production Section | Primary Entity |
|---------|----------------|
| HOOK | Jack Welch |
| BUILD | Jack Welch |
| ESCALATE | Jack Welch |
| LAND | Lincoln Electric |

Result: 3/4 (75%) = Jack Welch → `single-focus`

**Video type:** [single-focus | comparative | thematic | mystery]

### Step 2: Extract Primary Subject

Based on video_type from Step 1:

**For `single-focus`:**
- Primary subject = entity that dominates ≥75% of production_sections
- Must be SPECIFIC (e.g., "Jack Welch" not "business leaders")

**For `comparative`:**
- List all entities with ≥30% production_section coverage
- All are "primary"—titles can feature any of them

**For `thematic`:**
- Primary subject = the central question or theme
- Format as a concept, not a person (e.g., "the psychology of layoffs")

**For `mystery`:**
- Primary subject = the QUESTION being investigated
- NOT the answer (avoid spoilers)

**Primary subject:** [answer — must be specific, not generic]

### Step 3: Identify Secondary Elements

Secondary elements appear in the video but are NOT the main focus.

**CRITERIA:** An element is secondary if:
- It appears in <30% of production_sections
- It serves as contrast, example, or context
- Removing it wouldn't change the core message

**Secondary elements:**
1. [element] — [role: counterexample / modern example / historical context / etc.]
2. [element] — [role]

### Step 4: Identify Core Tension (Optional)

If the video has a clear gap between expectation and reality, capture it.

**Format:** "[Subject] is expected to [expectation], but actually [reality]"

**Examples:**
- "BMW is expected to build efficient cars, but their EVs burn 23% more energy than Tesla"
- "German engineering is expected to transfer across domains, but EV simplicity made it irrelevant"
- "Porsche is expected to dominate performance, but Xiaomi beat them by 20 seconds"

**If no clear tension exists:** Leave this field blank. Not all videos have tension, and that's fine. A specific factual title can still work.

### Step 5: Define the Core Promise

Complete this sentence: "After watching this video, the viewer will understand that..."

**CONSTRAINTS:**
- one_sentence: Maximum 30 words
- Must mention PRIMARY subject (from Step 2)
- Must NOT elevate any secondary element to main focus
- question_answered: Must end with "?"

**One sentence:** [complete the sentence, ≤30 words]

**Viewer transformation:** [what they know now that they didn't before]

**Question answered:** [the question this video resolves — must end with ?]

### Step 6: Validation Checkpoint

Before proceeding to title generation, ALL checks must pass:

**STRUCTURAL CHECKS:**
| Check | Pass/Fail |
|-------|-----------|
| video_type is one of: single-focus, comparative, thematic, mystery | |
| primary_subject is specific (not generic like "business" or "society") | |
| At least 1 secondary_element identified | |
| one_sentence is ≤30 words | |
| question_answered ends with "?" | |

**CONTENT CHECKS:**
| Check | Pass/Fail |
|-------|-----------|
| primary_subject appears in ≥2 production_sections from BEAT_GRAPH.yaml | |
| one_sentence does NOT mention any secondary_element as the main focus | |
| question_answered is answerable by watching the video (not rhetorical) | |

**VALIDATION RESULT:**
- ALL PASS → Proceed to title generation
- ANY FAIL → Apply auto-fix (see below) or escalate

**AUTO-FIX RULES:**
| Failure | Auto-Fix |
|---------|----------|
| primary_subject is generic | Replace with most frequent proper noun in POLISHED_SCRIPT |
| question_answered missing "?" | Append "?" |
| one_sentence >30 words | Truncate to first complete clause under 30 words |
| No secondary_element | Re-scan script for any contrasting examples or supporting figures |

**ESCALATION FORMAT (if auto-fix fails):**
```
CORE_PROMISE VALIDATION FAILED
Issue: [specific check that failed]
Attempted fix: [what was tried]
Human input needed: [specific question, e.g., "Who is the primary subject: Jack Welch or the concept of layoffs?"]
```

---

## OUTPUT

```yaml
core_promise:
  video_type: "[single-focus | comparative | thematic | mystery]"
  one_sentence: "[what this video delivers — ≤30 words]"
  viewer_transformation: "[what viewer understands after watching]"
  primary_subject: "[specific main person/company/concept]"
  secondary_elements:
    - element: "[name]"
      role: "[counterexample | modern example | historical context | etc.]"
  question_answered: "[the question this video answers — ends with ?]"

  # NEW (optional) — from Step 4
  core_tension: "[Subject] is expected to [X], but actually [Y]"

  validation_status: "[PASSED | PASSED_WITH_AUTO_FIX | ESCALATED]"
  section_analysis:
    total_production_sections: [N]
    primary_subject_sections: [N]
    coverage_percentage: [N%]
```

### Example (Layoffs Video)

```yaml
core_promise:
  video_type: "single-focus"
  one_sentence: "Jack Welch invented modern layoffs as a management philosophy, and that's why every company does them now."
  viewer_transformation: "Viewer understands that layoffs aren't natural or inevitable—they were deliberately designed by one CEO."
  primary_subject: "Jack Welch / GE"
  secondary_elements:
    - element: "Lincoln Electric"
      role: "Counterexample showing alternative approach"
    - element: "Sundar Pichai"
      role: "Modern example of Welch's influence"
  question_answered: "Why do companies keep doing layoffs even when they don't seem to need them?"
  core_tension: "Layoffs are expected to be necessary business decisions, but actually they were invented by one CEO as a management philosophy"
  validation_status: "PASSED"
  section_analysis:
    total_production_sections: 4
    primary_subject_sections: 3
    coverage_percentage: 75%
```

---

## PRINCIPLES

1. **Production section-based measurement** — Use objective production_section counts from BEAT_GRAPH.yaml, not subjective judgment
2. **Specific over generic** — "Jack Welch" not "business leaders"
3. **Validate before proceeding** — Bad core promise = bad everything downstream
4. **Auto-fix when possible** — Don't block on minor issues
5. **Escalate clearly** — When human input needed, ask specific questions

---

## EXECUTION OPTIONS

| Model | When to Use |
|-------|-------------|
| **DeepSeek** | Standard extraction from clear narratives |
| **Opus** | Complex videos, ambiguous structure, editorial judgment needed |

---

## NOTE

This is Step 1.5 in the YouTube Module pipeline. Output feeds directly into `title_generation.md`, which is constrained to only produce titles that express this core promise.

**CRITICAL:** If validation_status = ESCALATED, do NOT proceed to title generation until human resolves the issue.
