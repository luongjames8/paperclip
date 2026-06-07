# STEP 5: COVERAGE VALIDATION

## PURPOSE

Check coverage, flag thin slots, ensure uniqueness.

This step answers: "Is the research complete enough for Structure to work with?"

---

## INPUT

| Input | Source |
|-------|--------|
| `potential_beats` | From Step 4 (including counter-evidence) |
| `research_master` | Built during Steps 2-4 |
| `provisional_outline` | Original slots |
| `research_so_far` | Optional: pre-existing research from Discovery |

---

## OUTPUT

### `coverage_report.yaml`

```yaml
coverage_report:
  slots:
    - slot_id: AP_01
      beats_found: 8
      status: STRONG
      source_diversity: "4 sources, 3 types"
      # When research_so_far provided:
      from_provided: 3  # Seed cap applied
      from_fresh: 5

    - slot_id: AP_02
      beats_found: 4
      status: THIN
      source_diversity: "2 sources, 2 types"
      notes: "Insufficient market data available"
      from_provided: 1
      from_fresh: 3

    - slot_id: COUNTER
      beats_found: 5
      status: ADEQUATE

  summary:
    total_beats: 35
    total_slots: 5
    strong_slots: 3
    adequate_slots: 1
    thin_slots: 1
    counter_evidence_beats: 5

  # When research_so_far provided:
  research_so_far_usage:
    provided: true
    items_received: 12
    items_used: 8
    items_skipped: 4  # Redundant or exceeded seed cap
    per_slot:
      - slot_id: AP_01
        from_provided: 3  # Seed cap applied (had 5)
        from_fresh: 5
        total: 8

gaps_identified:
  - slot_id: AP_02
    reason: "Below floor (4 < 5)"
    recommendation: "Second research pass on China dealer data"

validation:
  all_slots_have_beats: true
  all_beats_unique: true
  counter_evidence_present: true
  source_diversity_met: true
  ready_for_structure: true

uniqueness_audit:
  duplicates_found: 0
  near_duplicates_merged: 2
  merges:
    - merged: [PB_05, PB_12]
      into: PB_05
      reason: "Both described same market share data"
```

---

## COVERAGE THRESHOLDS

| Status | Beats per Slot | Meaning |
|--------|----------------|---------|
| **STRONG** | 8+ | Ideal - many options for Structure |
| **ADEQUATE** | 5-7 | Meets floor - acceptable |
| **THIN** | < 5 | WARNING - below floor |

---

## VALIDATING research_so_far USAGE

When `research_so_far` was provided, track how it was used:

### Seed Cap Verification

For each slot:
```
provided_items = items from research_so_far matching slot
seed_contribution = min(provided_items, 3)  # Cap at 3
```

### Fresh Requirement Check

**Each slot MUST have 5+ fresh beats** (regardless of provided items):

```
If from_fresh < 5:
  → WARNING: Slot relies too heavily on provided items
  → Flag in gaps_identified
```

### Over-Reliance Warning

Flag slots where fresh research is insufficient:

```yaml
gaps_identified:
  - slot_id: AP_03
    reason: "Over-reliant on provided items"
    from_provided: 3
    from_fresh: 2  # Below 5 threshold
    recommendation: "Additional fresh research needed"
```

### Coverage Calculation with research_so_far

```
# With research_so_far provided:
total_beats = from_provided (max 3) + from_fresh (should be 5+)

# Expected minimum with research_so_far:
# 3 (seed cap) + 5 (fresh requirement) = 8 (STRONG)
```

| Slot Status | from_provided | from_fresh | Total | Status |
|-------------|---------------|------------|-------|--------|
| Ideal | 3 | 5+ | 8+ | STRONG |
| Acceptable | 2 | 5+ | 7+ | ADEQUATE |
| Under-researched | 3 | 3 | 6 | WARNING - fresh requirement not met |

---

## VALIDATION CHECKS

### Check 1: All Slots Have Beats

```
For each slot in provisional_outline:
  If beats_found == 0:
    → BLOCKER: Empty slot
    → all_slots_have_beats: false
```

**Empty slot = BLOCKER.** Pipeline cannot proceed.

### Check 2: No Redundant Beats

```
For each pair of beats:
  If beats describe same fact:
    → Merge or remove duplicate
    → Document in uniqueness_audit
```

**Uniqueness Test:**
- Same data point from same event? → Duplicate
- Same quote attributed to same person? → Duplicate
- Different angles on same event? → Distinct (keep both)

### Check 3: Counter-Evidence Present

```
If counter_evidence_beats < 3:
  → WARNING: Insufficient counter-evidence
  → May indicate biased research
```

### Check 4: Source Diversity Met

Per slot:
- Minimum 3 distinct sources
- At least 2 different source types
- No single source > 40% of findings

```
For each slot:
  Count unique sources
  Count unique source types
  Flag if below thresholds
```

---

## THIN SLOT HANDLING

Thin slots (< 5 beats) are flagged but NOT blockers.

### Gap Identification

```yaml
gaps_identified:
  - slot_id: AP_02
    beats_found: 4
    reason: "Below floor"
    searched_sources: "[what was already searched]"
    recommendation: |
      1. Try alternative search queries
      2. Broaden source types
      3. Accept thin coverage if material doesn't exist
```

### Second Pass Decision

| Situation | Recommendation |
|-----------|----------------|
| More sources exist, not searched | Second research pass |
| All reasonable sources exhausted | Accept THIN, document why |
| Slot is optional (required: false) | Skip second pass |

---

## UNIQUENESS AUDIT

### Duplicate Detection

Compare all beat pairs:

| Comparison | Result |
|------------|--------|
| Same fact, same wording | DUPLICATE - remove one |
| Same fact, different wording | NEAR-DUPLICATE - merge |
| Related facts, different angles | DISTINCT - keep both |
| Same event, different data points | DISTINCT - keep both |

### Merge Process

When merging near-duplicates:
1. Keep the stronger beat (more specific, better sourced)
2. Combine evidence_refs from both
3. Document in uniqueness_audit

```yaml
merges:
  - merged: [PB_05, PB_12]
    into: PB_05
    reason: "Both described Q3 2024 sales decline, PB_05 had specific numbers"
    evidence_refs_combined: [EV_008, EV_015, EV_023]
```

---

## READY FOR STRUCTURE CHECK

Pipeline can proceed when:

| Check | Required |
|-------|----------|
| All required slots have 1+ beats | YES (blocker) |
| All beats unique | YES (blocker) |
| Counter-evidence present (3+) | YES (warning if not) |
| No THIN slots | NO (warning only) |
| Source diversity met | NO (warning only) |

```yaml
ready_for_structure: true  # or false if blockers exist
```

---

## OUTPUT FILES

### Final Outputs

After validation, produce clean outputs using the following delimiter format:

```
--- FILE: RESEARCH_MASTER.yaml ---
(all sources, fully structured)
--- FILE: POTENTIAL_BEATS.yaml ---
(deduplicated beats)
--- FILE: COVERAGE_REPORT.yaml ---
(validation results — see schema below)
```

### COVERAGE_REPORT.yaml Schema

See the `coverage_report.yaml` schema above (coverage_report, gaps_identified, validation, uniqueness_audit blocks).

### Handoff Notes

Include notes for Structure:

```yaml
handoff_notes:
  total_beats: 35
  thin_slots: [AP_02]
  thin_slot_notes: "China dealer data limited - may need to de-emphasize this angle"
  counter_evidence_strength: "Strong - Toyota hybrid profits are real counter-argument"
  recommended_focus: "Beats PB_01, PB_03, PB_07 have strongest evidence"
```

---

## HARD CONSTRAINTS

- Empty required slot = BLOCKER
- Duplicate beats = BLOCKER (must dedupe)
- THIN slots = WARNING only
- Source diversity gaps = WARNING only
- All checks must be documented
- Uniqueness audit must be complete

---

## COMPLETION RULE

You are done when:
- All slots have coverage status assigned
- Uniqueness audit complete (no duplicates)
- Gaps identified and documented
- Counter-evidence presence verified
- Source diversity checked
- ready_for_structure determined
- Handoff notes written

---

## NEXT STEP

If `ready_for_structure: true`:
- Outputs go to Structure module
- Research phase complete

If `ready_for_structure: false`:
- Review blockers
- Second research pass if needed
- Re-run validation
