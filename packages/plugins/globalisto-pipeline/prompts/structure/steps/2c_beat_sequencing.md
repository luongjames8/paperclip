# Step 2c: Beat Sequencing

## One Job

Order the candidate beats into a narrative sequence using but/therefore chain flow.

**You are NOT designing loops, arcs, pacing, or credibility.** That happens in the next step. Your only job is: what order do these beats go in?

---

## Input

- `STEP2_selection.yaml` — candidate beats with descriptions
- `ANGLE_LOCK.yaml` — the title promise

## Output

```yaml
beat_sequence:
  - position: 1
    beat_id: string
    new_tension: string  # the question/complication this beat creates
    link_to_next: "but" | "therefore"  # how it connects to the next beat
  - position: 2
    beat_id: string
    problem: string  # what question from the previous beat this answers
    new_tension: string
    link_to_next: "but" | "therefore"
  # ... continue for all beats
```

---

## The Rule

Every beat connects to the next via **"but"** (complication) or **"therefore"** (consequence).

**"And then"** means the beats are not causally connected. Try a different beat from the pool.

---

## Process

1. **Find the hook beat** — highest hook_strength. This goes at position 1.
2. **Write its NEW_TENSION** — what question or complication does this beat create?
3. **Scan the remaining pool** — which beat's PROBLEM most directly answers, complicates, or results from that NEW_TENSION?
4. **Place it next.** Write the connection: "THEREFORE [beat]" or "BUT [beat]".
5. **Repeat until all beats are placed.**

The chain determines the sequence. NOT the topic. NOT the slot.

---

## Ordering Principles

1. **Stakes before context** — show the crisis before explaining the mechanism
2. **Example before theory** — the concrete scene creates the question; the abstract explanation answers it
3. **Delayed explanation** — the explanation that follows curiosity lands as revelation; the explanation that precedes curiosity lands as lecture

---

## Bad Example (topic blocks)

Title: "Samsung Copied For 50 Years. Then Nobody Was Left."

```
BEAT_01: Samsung's copying machine (copying)
BEAT_02: Speed — zero to world leader (copying)
BEAT_03: Repeatable playbook (copying)
BEAT_04: Phone burning — blame culture (culture)
BEAT_05: Academic mechanism — culture kills innovation (culture)
BEAT_06: HBM structural wall (crisis)
BEAT_07: Samsung not in the room (crisis)
BEAT_08: Below Micron (crisis)
BEAT_09: Data fabrication (culture again)
BEAT_10: Engineer Jin quote (culture again)
BEAT_11: Choi Jung-dal defection (exodus)
BEAT_12: Mass exodus (exodus)
BEAT_13: Chaebol pardon (chaebol)
BEAT_14: Three generations (closing)
```

**Why this fails:** Beats 4-5 explain blame culture BEFORE the viewer has seen the HBM crisis. The explanation precedes the curiosity. Culture theory is a lecture without stakes. Then beats 9-10 revisit culture AGAIN — "and then more blame culture."

Transitions between topic blocks are "and then":
- End of copying block → "AND THEN here's blame culture"
- End of culture block → "AND THEN here's the HBM crisis"
- End of crisis block → "AND THEN more culture examples"

---

## Good Example (chain-driven interleaving)

Same beats, reordered by but/therefore:

```
BEAT_01: Samsung's copying machine
  NEW_TENSION: "How good was this machine?"
  → THEREFORE:
BEAT_02: Speed — zero to world leader in 9 years
  NEW_TENSION: "If they mastered everything this fast, what could stop them?"
  → THEREFORE:
BEAT_03: Repeatable playbook — worked every time, paid fines as business expense
  NEW_TENSION: "So what DID stop them?"
  → BUT:
BEAT_06: HBM structural wall — for the first time, nothing to copy
  NEW_TENSION: "Why couldn't Samsung just catch up like always?"
  → BECAUSE:
BEAT_07: Samsung wasn't in the room — SK Hynix wrote the rulebook
  NEW_TENSION: "How did Samsung respond to failing tests?"
  → BUT:
BEAT_09: Data fabrication — engineers told to rewrite reports
  NEW_TENSION: "Where does this instinct to hide problems come from?"
  → THEREFORE:
BEAT_04: Phone burning — Lee Kun-hee installed a system that punished deviation
  NEW_TENSION: "But that culture built the empire — how is it also destroying it?"
  → THEREFORE:
BEAT_05: Academic mechanism — same culture, opposite effects depending on task
  NEW_TENSION: "What happened to the people who saw this?"
  → BUT:
BEAT_11: Choi Jung-dal — Samsung's best engineer left and beat them
  NEW_TENSION: "Was Choi an exception?"
  → THEREFORE:
BEAT_12: Mass exodus — hundreds leaving, same reasons
  NEW_TENSION: "Where does it end?"
  → BUT:
BEAT_08: Below Micron — the company Samsung copied in 1983 now leads
  NEW_TENSION: "Can Samsung fix this?"
  → BUT:
BEAT_13: Chaebol pardon — self-correction structurally impossible
  NEW_TENSION: [none — L_MAIN closes]
BEAT_14: Three generations of "crisis" [WEIGHT]
```

**Why this works:**
- HBM crisis (BEAT_06) comes right after the setup — stakes before context
- Blame culture (BEAT_04) comes AFTER data fabrication (BEAT_09) — the viewer sees the symptom first, then gets the origin as revelation
- The "below Micron" irony (BEAT_08) comes near the end as the gut punch, not in the middle
- Every transition is but/therefore — the chain never breaks

---

## Anti-Topic-Block Check

After sequencing, verify: no more than 2 consecutive beats from the same argument slot (AP_xx). If 3+ cluster together, the chain has collapsed into topic grouping. Find a cross-topic but/therefore link.

---

## Hard Constraints

- Position 1 MUST be the highest hook_strength beat
- Every transition MUST be "but" or "therefore", never "and then"
- Max 2 consecutive beats from the same slot
- The sequence must serve the title's promise
