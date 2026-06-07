# Step 4: Retention Ordering

**Version:** 1.1
**Last Updated:** 2026-01-24

## Purpose

Validate that retention-optimized beat order (from Step 3) satisfies hard logical dependencies. If dependencies are violated, resolve via inline context or flag for human review.

**Key principle:** Retention order is primary. Dependencies are constraints to validate, not reasons to reorder.

---

## Data Contract

### Input Schema

```yaml
retention_structure:
  beats: array  # with positions assigned
  main_loop: object
  supporting_loops: array
  arc_phases: object

classified_material:
  structural_support: array  # SS items to attach
```

### Output Schema

```yaml
ordered_graph:
  units:
    - unit_id: string
      position: int
      depends_on: array
      dependency_justification: string | null
      belief_state_before: string
      belief_state_after: string
      beat_type: string
      arc_phase: string
      active_loops: array
      audience_state: object
      structural_support: array

  dependency_chain: string

  logical_dependencies:
    satisfied: boolean
    conflicts: array
    resolutions: array

  final_belief_state: string
```

---

## Process

### Step 1: Accept Retention Order

Take positions from `retention_structure.beats` as baseline. This is retention-optimized.

### Step 2: Identify Hard Dependencies

**Hard dependency test:** "Would viewer be CONFUSED (not just less impacted) without this first?"

- YES → Hard (term definition, causal prerequisite, entity introduction)
- NO → Soft (narrative preference, emotional setup)

```yaml
dependencies:
  BEAT_03:
    depends_on: ["BEAT_02"]
    justification: "Uses term defined in BEAT_02"
  BEAT_05:
    depends_on: []
```

### Step 3: Check for Violations

Compare dependencies against retention positions. Violation = dependent comes before dependency.

```yaml
# Example:
BEAT_03 at position 2, depends_on: ["BEAT_02"]
BEAT_02 at position 4
Status: VIOLATED
```

### Step 4: Resolve Violations

**Option A: Inline Context (preferred)**
```yaml
resolution:
  type: "inline_context"
  beat_id: "BEAT_03"
  added_context: "McKinsey's 'turbo' strategy (aggressive sales targeting)"
  retention_order_preserved: true
```

**Option B: Context Beat Insertion**
```yaml
resolution:
  type: "context_beat_inserted"
  new_beat_id: "BEAT_02b"
  position: 2
  purpose: "Define 'turbo' before BEAT_03"
```

**Option C: Human Review (last resort)**
```yaml
conflict:
  type: "unresolvable_dependency"
  dependent_beat: "BEAT_03"
  required_dependency: "BEAT_02"
  options:
    - name: "Inline context"
      tradeoff: "Beat becomes heavy"
    - name: "Reorder"
      tradeoff: "Hook strength drops"
  requires: "human_decision"
```

### Step 5: Attach Structural Support

Attach SS items to supporting units:

```yaml
- unit_id: "BEAT_03"
  structural_support:
    - item_id: "SS_001"
      role: "explains mechanism"
```

SS items live INSIDE units, not as standalone units.

### Step 6: Assign Belief States

For each unit, assign `belief_state_before` and `belief_state_after`. Verify no backtracking in progression.

### Step 7: Generate Dependency Chain

Visual representation:
```
BEAT_01 → BEAT_02 → BEAT_03 → BEAT_04
```

---

## Hard Constraints

1. Position 1 MUST be L_MAIN opener
2. Hook zone (positions 1-2) protected - resolve via inline context, not reordering
3. Arc phase progression preserved
4. Hard dependencies MUST be satisfied (via ordering or inline context)
5. All conflicts MUST be logged
6. Belief states MUST progress (no backtracking)

---

## Output Example

```yaml
ordered_graph:
  units:
    - unit_id: "BEAT_01"
      position: 1
      depends_on: []
      dependency_justification: "Hook is self-contained"
      belief_state_before: "belief_intact"
      belief_state_after: "belief_questioned"
      beat_type: "tension"
      arc_phase: "INTRIGUE"
      active_loops: ["L_MAIN"]
      audience_state: { entering: "NEUTRAL", target: "CURIOSITY", risk: "CONFUSION" }
      structural_support: []

    - unit_id: "BEAT_02"
      position: 2
      depends_on: []
      belief_state_before: "belief_questioned"
      belief_state_after: "belief_questioned"
      beat_type: "context"
      arc_phase: "INTRIGUE"
      active_loops: ["L_MAIN"]
      audience_state: { entering: "CURIOSITY", target: "CURIOSITY", risk: "BOREDOM" }
      structural_support:
        - item_id: "SS_001"
          role: "defines key term"

  dependency_chain: "BEAT_01 → BEAT_02 → BEAT_03"
  logical_dependencies:
    satisfied: true
    conflicts: []
    resolutions: []
  final_belief_state: "belief_transformed"
```

---

## Next Step

`ordered_graph` → `steps/5_evidence_assignment.md`
