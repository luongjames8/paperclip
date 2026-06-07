# Step 8: Thematic Blueprint Compilation

**Version:** 1.0
**Last Updated:** 2026-03-18

## Purpose

Compile retention-ordered beats into `BEAT_GRAPH.yaml` and `BLUEPRINT.md` for downstream modules (Writing, Music, Packaging).

This is a **mechanical compilation** step. The creative decisions (arc phases, loops, tension chains, causal ordering) were made in Steps 6-7. This step formats them for consumption.

---

## Inputs

| Input | Source |
|-------|--------|
| `STEP7_ordering.yaml` | From Step 7 (retention ordering) — ordered graph with causal dependencies |
| `STEP6_retention_structure.yaml` | From Step 6 (retention structure) — arc phases, loops, tension chains |
| `ANGLE_LOCK.yaml` | Firm angle lock — title and promise |
| `STEP2_selected_themes.yaml` | From Step 2 — for enrichment pool (if present) |

---

## Outputs

Use the following delimiter format to separate the two output files:

```
--- FILE: BEAT_GRAPH.yaml ---
(content here)
--- FILE: BLUEPRINT.md ---
(content here)
```

### `BEAT_GRAPH.yaml`

The complete beat sequence with all retention architecture:

```yaml
beat_graph:
  beats:
    - beat_id: string
      position: int
      unit_id: string          # from ordered_graph
      description: string
      beat_type: "tension" | "context" | "bridge"

      # Arc lens
      arc_phase: "INTRIGUE" | "DISCOMFORT" | "RECOGNITION" | "COLLAPSE" | "WEIGHT"

      # Loop lens
      loops:
        opens:
          - loop_id: string
            question: string
            closes_at: string
        closes:
          - loop_id: string
            question: string
            opened_at: string

      # Tease (forward pull)
      tease:
        enabled: boolean
        target_beat: string | null
        target_loop: string | null
        text: string | null

      # Chain lens (tension beats only)
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

      # Dependencies
      depends_on: array
      belief_state_before: string
      belief_state_after: string

      hook_strength: "HIGH" | "MEDIUM" | "LOW"
      emotional_register: string
      content_items: array      # from candidate_units

  main_loop:
    question: string
    opens_at: string
    closes_at: string

  supporting_loops: array

  arc_phases:
    INTRIGUE: [beat_ids]
    DISCOMFORT: [beat_ids]
    RECOGNITION: [beat_ids]
    COLLAPSE: [beat_ids]
    WEIGHT: [beat_ids]

  dependency_chain: string

  # Production sections for music and midrolls
  production_sections:
    - section_id: int
      name: string
      mood: string
      beats: [beat_ids]
      timing: string
```

### `BLUEPRINT.md`

Human-readable writing guide organized by production section.

---

## Production Sections

Group beats into 3-4 sections based on function transitions and emotional arc:

### Section Rules

| Section | Position | Function | Mood Source |
|---------|----------|----------|------------|
| HOOK | First | Opening grab + stakes | First 1-2 beats |
| BUILD | Second | Foundation + early evidence | INTRIGUE → DISCOMFORT beats |
| ESCALATE | Third | Peak evidence + viewer recognition | RECOGNITION → COLLAPSE beats |
| LAND | Last | Resolution + consequences + weight | WEIGHT beats |

### Constraints

- **3-4 sections** (never fewer than 3, never more than 5)
- **HOOK always first** (section_id: 1)
- **LAND always last**
- **No gaps** — every beat in exactly one section
- **Timing contiguous** — end of section N = start of section N+1
- **Duration** — minimum 1 minute, maximum 5 minutes per section

### Mood Derivation

- Short phrase (2-4 words) from emotional registers of beats in that section
- Use `→` for transitions (e.g., "grief → revelation")
- Draw from arc_phase emotional progression

### Timing

- Use MM:SS format (e.g., "3:30-7:30")
- Derive from beat positions and estimated durations
- For videos >12 minutes, split ESCALATE into ESCALATE_1 and ESCALATE_2

---

## BLUEPRINT.md Format

```markdown
# BLUEPRINT: [Title from ANGLE_LOCK]

## Promise
[one_sentence_promise from ANGLE_LOCK]

## Main Loop
**Question:** [main_loop.question]
**Opens:** [beat_id] | **Closes:** [beat_id]

---

## SECTION 1: HOOK [timing]
**Mood:** [mood]

### BEAT_01 — [description]
- **Arc phase:** INTRIGUE
- **Audience state:** [entering] → [target] (risk: [risk])
- **Loops opening:** [loop questions]
- **Tease:** [tease text if enabled]
- **Content:** [content items summary]
- **Quotes available:** [quote refs if any]
- **Dependencies:** None (opening beat)

[repeat for each beat in section]

---

## SECTION 2: BUILD [timing]
...

## SECTION 3: ESCALATE [timing]
...

## SECTION 4: LAND [timing]
...

---

## Dependency Chain
[dependency_chain from ordered_graph]

## Enrichment Material Available (Not Structurally Necessary)
[If STEP2_selected_themes.yaml contains enrichment_pool, list items here]

> **Writer guidance:** Use in writing phase for texture, depth, and accessibility. Do NOT add as structural beats — these are optional material the writer MAY weave into existing sections.
```

---

## Process

### Step 1: Merge Retention Data

Combine `STEP6_retention_structure.yaml` (arc, loops, chains) with `STEP7_ordering.yaml` (positions, dependencies, belief states) into unified beat sequence.

For each beat:
1. Take position, depends_on, belief states from ordering
2. Take arc_phase, loops, tease, chain, audience_state from retention structure
3. Take content_items from the original candidate_units (referenced by unit_id)

### Step 2: Generate Production Sections

1. Review final beat positions
2. Group by arc phase transitions:
   - INTRIGUE beats → HOOK section
   - DISCOMFORT early beats → BUILD section
   - RECOGNITION + COLLAPSE beats → ESCALATE section
   - WEIGHT beats → LAND section
3. Adjust for timing balance (aim for 2-4 min per section)
4. Derive mood from emotional registers

### Step 3: Write BEAT_GRAPH.yaml

Assemble complete YAML with all fields.

### Step 4: Write BLUEPRINT.md

For each production section, for each beat:
- Write the beat entry with all context a writer needs
- Include loop events, teases, dependencies, quotes
- Flag causal prerequisites ("Establish X before this beat")

### Step 5: Append Enrichment Pool

If `STEP2_selected_themes.yaml` has an `enrichment_pool` section, append it to BLUEPRINT.md.

---

## Hard Constraints

- Do NOT change beat positions — they come from retention ordering
- Do NOT add or remove beats — compilation only
- Do NOT change loop assignments — they come from retention structure
- Production sections must cover ALL beats with no gaps
- BLUEPRINT.md must include dependency warnings for each beat
- Every tease must reference a specific loop closure

---

## Completion Rule

Done when:
- `BEAT_GRAPH.yaml` contains all beats with full retention architecture
- Production sections cover all beats (3-4 sections)
- `BLUEPRINT.md` has section-by-section writing guide
- Every beat has: position, arc_phase, loops, audience_state, dependencies
- Dependency chain is documented
- Enrichment pool appendix included (if available)

---

## Next Step

- `BEAT_GRAPH.yaml` → Writing module, Music module
- `BLUEPRINT.md` → Writing module (content execution)
