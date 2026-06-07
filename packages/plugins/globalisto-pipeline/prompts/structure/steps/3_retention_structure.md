# Step 3: Retention Structure Design

**Version:** 1.1
**Last Updated:** 2026-01-24

## Purpose

Design arc, loops, and tension chain as three views of ONE unified retention structure.

**Scope:** Narrative/documentary/expose content (DETONATOR, MIRROR classes).

---

## Data Contract

### Input Schema

```yaml
beat_sequence:
  sequence: array  # from 2c_beat_sequencing — ordered beats with but/therefore chain

candidate_units:
  units: array  # from unit_selection with hook_strength scored
  selection_mode: string

hook_zone:
  strength: "HIGH" | "MEDIUM" | "LOW"
  stakes: object
  curiosity_gap: object

content_class: "detonator" | "mirror"

force_of_opposition:
  type: "central_misconception" | "counterintuitive_truth" | "hidden_mechanism"
  statement: string
  why_strong: string

ANGLE_LOCK.yaml:  # Firm angle lock — the title promise that retention must serve
  title: string
  one_sentence_promise: string
  angle_type: string
```

### Output Schema

```yaml
retention_structure:
  beats:
    - beat_id: string
      beat_type: "tension" | "context" | "bridge"
      position: int

      # Arc lens
      arc_phase: "INTRIGUE" | "DISCOMFORT" | "RECOGNITION" | "COLLAPSE" | "WEIGHT"

      # Loop lens
      loop_events: array  # ["L_MAIN opens", "L_SUP_01 closes"]
      active_loops: array

      # NEW: Loops as property of beat
      loops:
        opens:
          - loop_id: string
            question: string
            closes_at: string  # beat_id where this loop closes
        closes:
          - loop_id: string
            question: string
            opened_at: string  # beat_id where this loop opened

      # NEW: Tease as property of beat (only if loop opens here)
      tease:
        enabled: boolean
        target_beat: string | null  # MUST match one of loops.opens[].closes_at
        target_loop: string | null  # which loop this tease serves
        text: string | null  # forward pull text referencing the loop question

      # Chain lens (for tension beats only)
      chain:
        problem: string | null
        consequence: string | null
        resolution: string | null
        new_tension: string | null

      # Audience state
      audience_state:
        entering: string
        target: string
        risk: string

      hook_strength: "HIGH" | "MEDIUM" | "LOW"

  main_loop:
    question: string
    opens_at: string  # beat_id
    closes_at: string

  supporting_loops: array  # Summary only (for backward compatibility)

  arc_phases:
    INTRIGUE: [beat_ids]
    DISCOMFORT: [beat_ids]
    RECOGNITION: [beat_ids]
    COLLAPSE: [beat_ids]
    WEIGHT: [beat_ids]

  pacing:
    max_beats_between_loop_events: 3
    max_open_loops: 5
    escalation_checkpoints: ["beat_3", "beat_6"]
    violations: array

  credibility:
    starting_budget: 100
    final_budget: int
    transactions: array  # [{beat_id, cost, reason}]
    warnings: array

  validation:
    coherent: boolean
    hook_at_position_1: boolean
    pacing_valid: boolean
    credibility_safe: boolean
```

---

## Beat Types

| Type | Chain Requirement | Max % |
|------|-------------------|-------|
| Tension Beat | Full PROBLEM→CONSEQUENCE→RESOLUTION→NEW_TENSION | 70-80% |
| Context Beat | Exempt from chain | Max 20% |
| Bridge Beat | NEW_TENSION only | Max 1 per 5 beats |

**Context beat rules:**
- Must be adjacent to tension beat that uses the context
- No clusters (max 2 in a row)

**Bridge beat rules:**
- Close one loop AND open another
- Mark arc phase transitions
- Carry only NEW_TENSION

---

## Arc Phases

| Phase | Audience State | Typical Position |
|-------|----------------|------------------|
| INTRIGUE | Curious, hooked | Beats 1-2 |
| DISCOMFORT | Challenged, uncertain | Beats 3-5 |
| RECOGNITION | Connecting dots | Beats 5-7 |
| COLLAPSE | Belief untenable | Beat 7-9 |
| WEIGHT | Processing implications | Final beat |

**Short form (< 5 min):** Phases may merge into thirds.

---

## Audience States

Track entering/target/risk states:

| State | Description |
|-------|-------------|
| NEUTRAL | No strong orientation |
| CURIOSITY | Want to know more |
| CONFUSION | Need clarification |
| DISCOMFORT | Challenged assumption |
| RECOGNITION | Connecting to existing knowledge |
| CONVICTION | New understanding forming |
| PROCESSING | Integrating implications |

**Risk states:** CONFUSION, BOREDOM, OVERWHELM, PREMATURE_CLOSURE

---

## Credibility Budget

```yaml
credibility:
  starting_budget: 100

  costs:
    standard_claim: 5
    escalation: 10
    unearned_escalation: 30

  earnings:
    evidence_presented: +5
    source_cited: +3
    counterargument_addressed: +10

  thresholds:
    warning: 30
    minimum: 20
```

For each beat: calculate costs, earnings, update budget, flag if < minimum.

---

## Pacing Rules

```yaml
pacing_rules:
  max_beats_between_loop_events: 3
  max_open_loops: 5
  escalation_checkpoints:
    - beat_3: "Tension higher than opening"
    - beat_6: "At least one loop close"
  min_active_loops: 1
```

---

## Process

**IMPORTANT:** Beat ordering has already been decided in `2c_beat_sequencing`. Accept the sequence as given. Do NOT reorder beats. Your job is to apply retention mechanics (loops, arcs, pacing) to the existing sequence.

### Step 1: Accept Beat Sequence

Read `beat_sequence` from input. The positions are fixed. The but/therefore chain between beats is already validated.

**Position 1 is the hook beat and MUST open L_MAIN.**

### Step 2: Design Main Loop (L_MAIN)

```yaml
main_loop:
  question: "[derived from hook beat's curiosity gap]"
  opens_at: "[BEAT_01]"
  closes_at: "[typically 80-90% through]"
```

### Step 3: Map Arc Phases to Loop Events

| Arc Moment | Loop Alignment |
|------------|----------------|
| INTRIGUE start | L_MAIN opens |
| DISCOMFORT peak | Supporting loop opens |
| RECOGNITION | Supporting loop closes |
| COLLAPSE | L_MAIN closes |
| WEIGHT | All loops closed |

### Step 4: Design Supporting Loops

Create 1-3 supporting questions that:
- Open after L_MAIN (beats 2-4)
- Close before L_MAIN closes
- Align with arc phase transitions

### Step 4b: Integrate Loops and Teases Per-Beat

For each beat that OPENS a loop:
1. Add the loop to that beat's `loops.opens` array
2. Create a tease that:
   - `enabled: true`
   - `target_beat` = the loop's `closes_at` beat
   - `target_loop` = the loop's ID
   - `text` = a forward pull that references the loop question

**CRITICAL:** The `tease.target_beat` MUST match the loop's `closes_at`. This creates the multi-loop pull.

**Example:** If L_SUP_01 opens at BEAT_02 and closes at BEAT_03:
- `BEAT_02.loops.opens` = `[{loop_id: "L_SUP_01", question: "...", closes_at: "BEAT_03"}]`
- `BEAT_02.tease` = `{enabled: true, target_beat: "BEAT_03", target_loop: "L_SUP_01", text: "..."}`

For beats that DON'T open loops:
- `loops.opens` = `[]`
- `tease.enabled` = `false`
- `tease.target_beat` = `null`
- `tease.target_loop` = `null`
- `tease.text` = `null`

For beats that CLOSE a loop:
- Add the loop to that beat's `loops.closes` array with the `opened_at` beat_id

### Step 5: Assign Beat Types

For each beat:
1. Default to **tension**
2. Mark **context** if: definition/explanation, no stakes, required for comprehension
3. Mark **bridge** if: transitions sections, closes one loop + opens another

### Step 6: Verify Tension Chain Continuity

The but/therefore chain was built during beat sequencing (step 2c). For each tension beat, verify:
- PROBLEM, CONSEQUENCE, RESOLUTION, NEW_TENSION are present
- NEW_TENSION of beat N connects to PROBLEM of beat N+1
- No "and then" connections exist
- Context beats are exempt but must be adjacent to the tension beat they support

### Step 7: Assign Audience States

For each beat:
```yaml
audience_state:
  entering: "[state from previous beat's target]"
  target: "[state we want after this beat]"
  risk: "[state if beat fails]"
```

### Step 8: Check Pacing Constraints

Verify:
- [ ] No more than 3 beats between loop events
- [ ] No more than 5 loops open at once
- [ ] At least 1 loop active at all times
- [ ] Escalation checkpoints met
- [ ] Max 20% context beats
- [ ] Max 1 bridge beat per 5 beats

### Step 9: Check Credibility Budget

Walk through beats tracking claim costs, evidence earnings, running budget. Verify stays above minimum.

### Step 10: Validate Coherence

Check arc/loops/chain tell same story:
- Loop opens align with arc phase starts
- Loop closes align with arc phase completions
- Chain connections mirror arc escalation
- No contradictions between lenses

---

---

## EPILOGUE DECISION

After identifying the resolution beat (where main loop closes), decide if an epilogue is needed.

**Default:** End on resolution. Epilogue is the exception.

### INCLUDE EPILOGUE IF (must meet at least one):
1. **New authoritative voice:** Expert quote or testimony not previously cited
2. **Forward-looking implication:** Future trend or actionable next step (not rehash)
3. **Surprising data point:** High-impact stat that reframes the resolution
4. **Powerful anecdote:** Story that embodies the core message in 2-3 sentences

### DO NOT INCLUDE EPILOGUE IF:
- Just elaboration on the resolution
- Would require backstory or character introduction
- Rehashes evidence already covered
- Could be cut without losing meaning

### DECISION CHECKLIST:
```yaml
□ Does it introduce something NEW? (not covered in resolution)
□ Can it be stated in ≤50 words?
□ Does it land with weight, not explanation?
□ If removed, would the video feel incomplete?

If 4/4 YES → include epilogue
If any NO → end on resolution
```

### IF EPILOGUE INCLUDED:
- Mark final beat with `is_epilogue: true`
- ONE evidence point only
- No new character introductions with setup
- No buildup - state fact, state implication, stop

## GRAND PAYOFF ARCHITECTURE

The Grand Payoff is the moment the viewer feels the title was fully delivered. Without explicit architecture, scripts drift into interesting-but-untethered content that satisfies curiosity without fulfilling the promise.

### Grand Payoff Definition

**Required:** Before designing retention structure, extract from `ANGLE_LOCK.yaml`:

```yaml
grand_payoff:
  title: "[locked title]"
  definition: "[what specific thing will make the viewer feel the title was delivered?]"
  source: "ANGLE_LOCK.yaml → grand_payoff"
```

The Grand Payoff is NOT "the conclusion" or "a summary." It is the specific revelation, proof, or narrative moment that closes the master loop opened by the title.

**Example:**
- Title: "How Sony Destroyed Itself" → Grand Payoff: The moment the viewer sees the specific chain of decisions that turned Sony from untouchable to irrelevant — and understands it was self-inflicted, not market forces.
- Title: "Why Nobody Can Copy IKEA" → Grand Payoff: The reveal that IKEA's real product isn't furniture — it's a system so deeply integrated that copying any piece of it actually makes you worse off.

### Grand Payoff Reminders (Every 5–6 Minutes)

For videos 15–25 minutes long, the viewer needs periodic reconnection to the title's promise. Without reminders, content drifts and the viewer forgets WHY they're watching.

**Placement:** Every 5–6 minutes of script runtime, insert a Grand Payoff Reminder — a beat or transition that explicitly reconnects the current content to the title's promise.

**Reminder techniques:**
1. **Re-open the master loop:** "But that's only the first part of why Sony destroyed itself..." — acknowledges progress while signaling more to come
2. **Progress marker:** "So now we know HOW the decision was made. But we still don't know WHY they thought it would work." — shows the viewer where they are on the journey
3. **Escalation tease:** "And that mistake? It's nothing compared to what came next." — reconnects AND builds forward pull
4. **Title echo:** Use language from the actual title naturally. If the title says "destroyed," the reminder should reference destruction, not "decline" or "challenges."

**Placement map for typical 20-minute video:**
| Timestamp | Function |
|-----------|----------|
| 0:00–0:30 | Title confirmation (hook) |
| ~5:00 | Reminder #1 — reconnect + signal the journey is still early |
| ~10:00 | Reminder #2 — escalate stakes, show the promise is deepening |
| ~15:00 | Reminder #3 — final tease before Grand Payoff delivery |
| ~17:00–19:00 | Grand Payoff delivery — the title's promise fully fulfilled |

**Validation:** If any 5-minute segment cannot be connected to the title's promise via a natural reminder, that segment may be off-topic and should be flagged for review.

### Micro-Loops (60–90 Second Cycles)

Every 60–90 seconds, the script must contain a **Setup-Tension-Payoff** cycle:

- **Setup** (5–15s): Introduce a specific question, mystery, or contradiction
- **Tension** (30–60s): Build anticipation — explore the stakes, add complexity, close escape hatches
- **Payoff** (10–20s): Deliver the answer or revelation

**Critical rule:** The gap between Setup and Payoff is where retention lives. Never give the Payoff immediately after Setup. The Tension phase is not filler — it's where the viewer becomes invested in the answer.

**Example micro-loop:**
- Setup: "Sony had the technology, the talent, and the market. So who made the call to throw it all away?"
- Tension: Walk through the internal politics, the competing divisions, the specific meeting where the decision was made. Each detail raises the stakes.
- Payoff: "It was Nobuyuki Idei. And he didn't even understand what he was killing."

**Micro-loop pacing check:** Map the script timeline. If any 90-second window lacks a clear Setup-Tension-Payoff cycle, flag it as a retention risk zone.

### Grand Payoff Placement

The full delivery of the title's promise comes at or near the end (typically 80–90% through the video).

**Rules:**
1. The Grand Payoff MUST use language that echoes the title, creating a closed loop. If the title says "destroyed," the payoff moment uses "destroyed" — not a synonym.
2. The Grand Payoff MUST feel earned — every section prior should have built toward this moment.
3. After the Grand Payoff, only a WEIGHT beat or brief epilogue remains. No new arguments.
4. The viewer should be able to articulate the title's answer after watching the Grand Payoff.

---

## RETENTION ARCHITECTURE VALIDATION

After the retention structure is designed, validate it against these benchmarks derived from retention curve research.

### Benchmark Map

| Timeframe | Requirement | Benchmark |
|-----------|-------------|-----------|
| 0:00–0:05 | Title confirmation — attention grab | Viewer knows this is the video they clicked for |
| 0:05–0:15 | Promise clarification | One-sentence promise stated or implied |
| 0:15–0:30 | Stakes + forward curiosity gap | New gap opens to carry past One Minute Wall |
| 0:25–0:35 | Pattern interrupt | Tonal shift, surprising fact, or visual change |
| 0:00–1:00 | One Minute Wall survival | Enough momentum to retain 45%+ of viewers (benchmark: only 45% pass this wall) |
| Every 60–90s | Micro-loop cycle | Setup-Tension-Payoff present |
| Every 5–6 min | Grand Payoff reminder | Reconnection to title's promise |
| No section >3 min | Re-engagement moment | At least one hook, reveal, or pattern interrupt per 3-minute window |
| Every section end | Forward curiosity gap | Dead transitions forbidden — every section must open a gap pointing forward |
| 80–90% mark | Grand Payoff delivery | Title promise fully fulfilled |

### Dead Transition Check

A "dead transition" is any section boundary where:
- The current section wraps up neatly without opening a new question
- The viewer could stop watching and feel satisfied
- The transition relies on chronology ("Next..." / "Then..." / "After that...") instead of causality or curiosity

**Every section end must leave something unresolved** that the next section promises to address.

### Retention Architecture Map Output

After validation, output a timeline map:

```yaml
retention_architecture_map:
  timeline:
    - timestamp: "0:00–0:05"
      element: "title_confirmation"
      description: "[what happens]"
      status: "PRESENT" | "MISSING" | "WEAK"
    
    - timestamp: "0:05–0:15"
      element: "promise_clarification"
      description: "[what happens]"
      status: "PRESENT" | "MISSING" | "WEAK"
    
    - timestamp: "0:15–0:30"
      element: "stakes_and_gap"
      description: "[what happens]"
      status: "PRESENT" | "MISSING" | "WEAK"
    
    - timestamp: "0:25–0:35"
      element: "pattern_interrupt"
      description: "[what happens]"
      status: "PRESENT" | "MISSING" | "WEAK"

    # Continue for full video timeline...
    # Mark each: micro-loop, grand_payoff_reminder, re-engagement_moment, section_transition

  micro_loops:
    - loop_number: 1
      timestamp: "0:00–1:15"
      setup: "[question/mystery]"
      tension: "[build]"
      payoff: "[delivery]"
    # Continue for all micro-loops...

  grand_payoff_reminders:
    - reminder_number: 1
      timestamp: "~5:00"
      technique: "[re-open / progress / escalation / echo]"
      text: "[actual reminder text or description]"
    # Continue for all reminders...

  dead_transitions: []  # List any section boundaries that fail the dead transition check

  retention_risks:
    - timestamp: "[range]"
      risk: "[description of retention risk]"
      severity: "HIGH" | "MEDIUM" | "LOW"
      mitigation: "[suggested fix]"

  overall_status: "PASS" | "REVIEW" | "FAIL"
  notes: "[any structural concerns]"
```

### Validation Rules

- **FAIL** if: First 30 seconds missing title confirmation, OR any 3+ minute window without re-engagement, OR Grand Payoff absent
- **REVIEW** if: Pattern interrupt missing/weak, OR 1-2 dead transitions found, OR micro-loop gaps in 2+ windows
- **PASS** if: All benchmarks met, no dead transitions, micro-loops and reminders properly placed

---

## Conflict Resolution

Priority order:
1. **L_MAIN opener → position 1** (always wins)
2. **Chain causality > arc phase** (comprehension before emotion)
3. **Pacing > individual loop timing** (overall rhythm matters)

If unresolvable:
```yaml
conflict:
  type: "unresolvable"
  lenses_involved: ["arc", "chain"]
  description: "[nature of conflict]"
  options:
    - option_1: "[description]"
      tradeoff: "[what's lost]"
  requires: "human_review"
```

---

## Hard Constraints

- Highest hook-strength beat MUST be at position 1
- L_MAIN MUST open in beats 1-2
- At least one loop active at all times
- Context beats MUST be adjacent to beats that use them
- Credibility budget MUST stay above 20
- Arc phases MUST progress (no backtracking)
- When a beat opens a loop, its tease MUST target that loop's closes_at beat
- The hook beat (position 1, highest hook_strength) MUST CONFIRM the locked title's promise
- Do NOT introduce a new hook that contradicts or ignores the title
- The retention structure serves the title — every loop, tease, and payoff should build toward delivering the title's promise

---

## Output Example

```yaml
retention_structure:
  beats:
    - beat_id: "BEAT_01"
      beat_type: "tension"
      position: 1
      arc_phase: "INTRIGUE"
      loop_events: ["L_MAIN opens"]
      active_loops: ["L_MAIN"]
      loops:
        opens:
          - loop_id: "L_MAIN"
            question: "How did McKinsey get paid per overdose death?"
            closes_at: "BEAT_08"
        closes: []
      tease:
        enabled: true
        target_beat: "BEAT_08"
        target_loop: "L_MAIN"
        text: "But the real question is how this payment structure was even legal"
      chain:
        problem: "McKinsey was paid $14,810 per opioid overdose death"
        consequence: "This payment structure created incentive for more deaths"
        resolution: null
        new_tension: "How did this arrangement even exist?"
      audience_state:
        entering: "NEUTRAL"
        target: "CURIOSITY"
        risk: "CONFUSION"
      hook_strength: "HIGH"

    - beat_id: "BEAT_02"
      beat_type: "context"
      position: 2
      arc_phase: "INTRIGUE"
      loop_events: []
      active_loops: ["L_MAIN"]
      loops:
        opens: []
        closes: []
      tease:
        enabled: false
        target_beat: null
        target_loop: null
        text: null
      chain: null  # context beat, exempt
      audience_state:
        entering: "CURIOSITY"
        target: "CURIOSITY"
        risk: "BOREDOM"
      hook_strength: "LOW"

    - beat_id: "BEAT_03"
      beat_type: "tension"
      position: 3
      arc_phase: "DISCOMFORT"
      loop_events: ["L_SUP_01 opens"]
      active_loops: ["L_MAIN", "L_SUP_01"]
      loops:
        opens:
          - loop_id: "L_SUP_01"
            question: "Did they know people would die?"
            closes_at: "BEAT_06"
        closes: []
      tease:
        enabled: true
        target_beat: "BEAT_06"
        target_loop: "L_SUP_01"
        text: "The internal emails reveal something even more disturbing"
      chain:
        problem: "McKinsey advised Purdue to 'turbocharge' opioid sales"
        consequence: "More aggressive sales meant more deaths"
        resolution: "Documents show the strategy was implemented"
        new_tension: "Did they anticipate the death toll?"
      audience_state:
        entering: "CURIOSITY"
        target: "DISCOMFORT"
        risk: "OVERWHELM"
      hook_strength: "HIGH"

  main_loop:
    question: "How did McKinsey get paid per overdose death?"
    opens_at: "BEAT_01"
    closes_at: "BEAT_08"

  supporting_loops:
    - id: "L_SUP_01"
      question: "Did they know people would die?"
      opens_at: "BEAT_03"
      closes_at: "BEAT_06"

  arc_phases:
    INTRIGUE: ["BEAT_01", "BEAT_02"]
    DISCOMFORT: ["BEAT_03", "BEAT_04", "BEAT_05"]
    RECOGNITION: ["BEAT_06"]
    COLLAPSE: ["BEAT_07", "BEAT_08"]
    WEIGHT: ["BEAT_09"]

  pacing:
    violations: []

  credibility:
    starting_budget: 100
    final_budget: 65
    transactions:
      - beat_id: "BEAT_01"
        cost: 10
        reason: "Large claim (paid per death)"
      - beat_id: "BEAT_03"
        cost: 5
        earning: 8
        reason: "Claim with citation"
    warnings: []

  validation:
    coherent: true
    hook_at_position_1: true
    pacing_valid: true
    credibility_safe: true
```

---

## Next Step

`retention_structure` → `steps/4_retention_ordering.md`
