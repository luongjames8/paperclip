# Narrative Critique

## One Job

Identify specific problems in the script. You do NOT fix them — you only identify them with line-level precision.

---

## Input

- `LEVEL_COMPLETE.md` — the leveled script (after language_level, before language_smooth)

## Output

```yaml
narrative_critique:
  and_then_transitions:
    - section: int
      before: "exact sentence 1"
      after: "exact sentence 2"
      why: "these connect via chronology, not causality"
    # or: "none found"

  forward_references:
    - section: int
      sentence: "exact sentence"
      assumes: "what the viewer doesn't know yet"
      intentional: boolean  # true if this is a cold opener or tease technique
    # or: "none found"

  meta_narration:
    - section: int
      phrase: "exact phrase"
    # or: "none found"

  repeated_information:
    - first_occurrence:
        section: int
        text: "exact text"
      second_occurrence:
        section: int
        text: "exact text"
    # or: "none found"

  energy_dips:
    - section: int
      word_count: int
      issue: "description"
    # or: "none found"
```

---

## What to Check

### 1. "And then" transitions

Any place where two consecutive sentences or sections connect via chronology rather than "but" or "therefore." The test: can you insert "but" or "therefore" between them? If only "and then" or "also" or "meanwhile" fits, flag it.

### 2. Forward references

Any sentence that assumes the viewer knows something not yet established. Exception: cold openers and tease lines are INTENTIONAL forward references — mark these `intentional: true` so the fix agent skips them.

### 3. Meta-narration

Any place the script talks about itself: "this video explains", "as we'll see", "here is the part that", "so now we know", "let's look at." The script should SHOW, not announce what it's showing.

### 4. Repeated information

Any sentence that restates something already said — word-for-word or paraphrased. Quote both instances. Exception: deliberate callbacks (where a phrase from the hook returns at the climax for payoff) are intentional — note these.

### 5. Energy dips

Any section significantly longer or denser than surrounding sections. Compare word counts. A section 50%+ longer than its neighbors is a flag.

---

## Rules

- Be SPECIFIC. Quote exact text. Give section numbers.
- Only flag REAL problems. If it's not broken, don't flag it.
- Do NOT suggest fixes. Do NOT rewrite anything.
- If the script is clean on a criterion, say "none found."
- Mark intentional techniques (cold openers, teases, callbacks) so the fix agent knows to skip them.
