# HOOK CONFIRMATION GATE

**Version:** 1.0
**Last Updated:** 2026-03-04

## Purpose

Quality gate that runs AFTER `content_execution` and BEFORE `punch_up`. Validates that the opening 30 seconds of DRAFT_CONTENT.md specifically confirms the locked title's promise — not just "engages" the viewer.

**Why this gate exists:** Research shows 70%+ of audience loss happens when the hook fails to confirm the click. A generic hook that works for any title is a retention failure. The opening must make the viewer feel "yes, this is exactly what I clicked for."

---

## Inputs

| Input | Required | Source |
|-------|----------|--------|
| `DRAFT_CONTENT.md` | Yes | From content_execution |
| `ANGLE_LOCK.yaml` | Yes | Locked title, one-sentence promise, grand payoff definition |

---

## Gate Checks

### Check 1: Attention Grab (0:00–0:05, ~15 words)

**Question:** Does the opening visually/verbally confirm THIS title's promise?

**Test:** "Would this opening make sense with a DIFFERENT title?"
- If YES → **FAIL** (the hook is generic, not title-specific)
- If NO → PASS (the hook is married to this specific title)

**Examples:**
- Title: "How Sony Destroyed Itself" → ✅ "In 1999, Sony owned the future. Music, movies, gaming, electronics — no company on Earth had more power. Then they lit it all on fire."
- Title: "How Sony Destroyed Itself" → ❌ "The tech industry is full of cautionary tales." (works for any company — generic)
- Title: "Why Nobody Can Copy IKEA" → ✅ "There are 7,000 products in an average IKEA store. Not one of them is the real product."
- Title: "Why Nobody Can Copy IKEA" → ❌ "Some companies build moats so deep that competitors can't even see across." (works for any company)

### Check 2: Promise Clarification (0:05–0:15, ~30 words)

**Question:** Does the script explicitly state what the video will deliver?

**Validation:** Compare against `ANGLE_LOCK.yaml → one_sentence_promise`. The script's promise must match in substance (not necessarily word-for-word).

- Match → PASS
- Mismatch or absent → **FAIL**

### Check 3: Stakes/Journey (0:15–0:30, ~40 words)

**Question:** Does the script establish why this matters AND open a curiosity gap that carries past the One Minute Wall?

**Requirements:**
- Stakes are established (why should the viewer care?)
- A new curiosity gap opens (not the same as the title's gap — a FORWARD gap)
- The gap must be compelling enough to survive 30 more seconds of viewing

If the viewer could stop at 0:30 without feeling they'd miss something → **FAIL**

### Check 4: Filler Detection

**Automatic FAIL if the opening contains ANY of these:**
- "Hey guys"
- "Welcome back"
- "In this video"
- "Before we get started"
- "Let me explain"
- "What's up everyone"
- "So today"
- Channel branding, logos, or intro sequences before the hook
- Subscribe/like requests before the hook
- Sponsor mentions before the hook

### Check 5: Cold Viewer Test

**Question:** "Would someone who found this via Browse, having only seen the title and thumbnail, feel immediately confirmed in their click by the first 5 seconds?"

This viewer:
- Has never seen your channel before
- Clicked because the title + thumbnail created a specific expectation
- Will leave in 5-8 seconds if that expectation isn't confirmed
- Does NOT care about your channel, your style, or your previous videos

If the opening requires channel context or prior viewing to land → **FAIL**

---

## Output Format

```yaml
HOOK_CONFIRMATION_GATE:
  status: "PASS" | "FAIL"
  
  checks:
    attention_grab:
      status: "PASS" | "FAIL"
      title_specificity_test: "Would this work with a different title? [YES/NO]"
      notes: "[specific issue or confirmation]"
    
    promise_clarification:
      status: "PASS" | "FAIL"
      angle_lock_promise: "[from ANGLE_LOCK.yaml]"
      script_promise: "[what the script actually promises]"
      alignment: "MATCH" | "MISMATCH" | "ABSENT"
    
    stakes_journey:
      status: "PASS" | "FAIL"
      stakes_present: true | false
      curiosity_gap_opened: true | false
      carries_past_one_minute_wall: true | false
    
    filler_detection:
      status: "PASS" | "FAIL"
      filler_found: ["list of filler phrases detected"]
    
    cold_viewer_test:
      status: "PASS" | "FAIL"
      requires_channel_context: true | false
      confirms_click_in_5s: true | false

  rewrite_instructions: |
    [If FAIL: Specific, actionable rewrite guidance for each failed check.
     Reference the locked title and one-sentence promise.
     Provide a structural template for the rewrite, not just "make it better."]
```

---

## Recovery on FAIL

1. Identify which checks failed
2. Re-read `ANGLE_LOCK.yaml` — specifically `title`, `one_sentence_promise`, and `grand_payoff`
3. Rewrite Section 1 of DRAFT_CONTENT.md following this structure:
   - **Words 1–15:** Confirm the title. Name the subject. State the surprising fact or tension.
   - **Words 16–45:** Clarify the promise. What will this video show/prove/reveal?
   - **Words 46–80:** Establish stakes and open the forward curiosity gap.
4. Re-run this gate
5. If FAIL 2x → flag for human review with both attempts attached

---

## Hard Constraints

- This gate does NOT rewrite — it evaluates and provides instructions
- This gate does NOT check writing quality — only title-promise alignment
- All checks reference `ANGLE_LOCK.yaml` as ground truth
- A single check failure = overall FAIL (all 5 must pass)

---

## Integration

- **Runs after:** `content_execution.md`
- **Runs before:** `punch_up` (polish phase)
- **Blocks on FAIL:** Content does not advance to polish until this gate passes

---

*The hook is not where you get creative. It's where you keep the promise.*
