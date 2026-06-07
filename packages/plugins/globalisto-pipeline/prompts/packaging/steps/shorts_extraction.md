# SHORTS EXTRACTION

## PURPOSE

Extract 4 YouTube Shorts from a polished script for promotional use around the main video release.

---

## INPUTS

| Input | Source | Purpose |
|-------|--------|---------|
| `POLISHED_SCRIPT.md` | phase_10 | Source content for extraction |
| `topic_name` | User | Video identifier |

---

## OUTPUT

`SHORTS_PACKAGE.md`

---

## PROMPT

```
You are extracting YouTube Shorts from a long-form video script.

Read the POLISHED_SCRIPT below and extract exactly 4 shorts:

1. **HOOK** — The cold open (first 45-60 seconds). Should create immediate curiosity.

2. **STAT** — The single most surprising number in the script + 2-3 sentences of context. Should make someone say "wait, what?"

3. **VILLAIN** — A damning quote or decision moment. The part that makes the subject look bad or reveals the core problem.

4. **TWIST** — The counterintuitive reveal or paradox. The moment that flips expectations.

For each short, provide:
- **Type:** (HOOK/STAT/VILLAIN/TWIST)
- **Section:** Which section of the script it comes from
- **Timecode:** _________ → _________ (EDITOR FILLS)
- **Script:** The exact excerpt (30-60 seconds when spoken at ~150 wpm, so roughly 75-150 words)
- **Visual notes:** 2-3 bullet points on what should be on screen
- **CTA:** Call to action or note if none needed

Also include:
- Release schedule (D-1, D0, D+1, D+3, D+6)
- Tracking table

Output in markdown format matching this structure:

---

# SHORTS PACKAGE: [VIDEO NAME]

## Video: [Title]

---

## Short #1: HOOK
**Type:** Cold open
**Section:** [Section name]
**Timecode:** _________ → _________ (EDITOR FILLS)

**Script:**
> [Exact excerpt]

**Visual notes:**
- [Note 1]
- [Note 2]

**CTA:** [Call to action or "None"]

---

[Repeat for Short #2, #3, #4]

---

## Release Schedule

| Day | Asset | Notes |
|-----|-------|-------|
| D-1 | Short #1 (HOOK) | Build anticipation |
| D0 | **LONG-FORM DROPS** | Main video |
| D+1 | Short #2 (STAT) | |
| D+3 | Short #3 (VILLAIN) | |
| D+6 | Short #4 (TWIST) | |

---

## Tracking

| Short | Scripted | Timecode | Edited | Posted | Link |
|-------|----------|----------|--------|--------|------|
| #1 HOOK | [x] | [ ] | [ ] | [ ] | |
| #2 STAT | [x] | [ ] | [ ] | [ ] | |
| #3 VILLAIN | [x] | [ ] | [ ] | [ ] | |
| #4 TWIST | [x] | [ ] | [ ] | [ ] | |

---

**END SHORTS PACKAGE**
```

---

## TIPS

- If the AI picks weak excerpts, ask it to "find a more surprising stat" or "find a more damning quote"
- The HOOK should almost always be your cold open — don't let it pick something from the middle
- Review the word count — each excerpt should be 75-150 words (30-60 seconds spoken)

---

## EXECUTION OPTIONS

| Model | When to Use |
|-------|-------------|
| **Opus (Recommended)** | Default choice — better excerpt selection + strategic guidance |
| DeepSeek | Only if maximum cost savings needed (accept quality hit) |

> **Tested (RUN_20260119_1026).** Opus outperformed on excerpt selection (chose more shareable stats, aligned villain with title strategy) and added release strategy modifications with reasoning. Worth the cost for strategic alignment.
