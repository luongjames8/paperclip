# STEP 1: SLOT ANALYSIS

## PURPOSE

Understand what each slot needs and decompose into searchable queries.

This step answers: "What specific evidence would fill this slot?"

---

## INPUT

| Input | Source |
|-------|--------|
| `provisional_outline` | Slots to fill (from scaffold OR discovery) |
| `belief` | The belief being addressed |
| `research_so_far` | Optional: pre-existing research from Discovery |

---

## OUTPUT

### `slot_queries.yaml`

```yaml
slot_queries:
  - slot_id: AP_01
    description: "[original slot description]"
    required: true

    # Decomposition
    interpretation: "[What this slot is really asking for]"
    evidence_types_needed:
      - "[type 1: e.g., quantitative data]"
      - "[type 2: e.g., expert statements]"
      - "[type 3: e.g., case examples]"

    # Search strategy
    search_queries:
      - "[specific query 1]"
      - "[specific query 2]"
      - "[specific query 3]"

    # Belief connection
    pressure_direction: "[How evidence here would pressure the belief]"
```

---

## SLOT ANALYSIS PROCESS

### Step 1: Read the Slot

For each slot in `provisional_outline`:
- What does the description literally say?
- What is it REALLY asking for?
- What would "good evidence" look like?

### Step 2: Connect to Belief

- How does this slot relate to the belief?
- What pressure direction would evidence apply?
  - Supports belief? Challenges belief? Complicates belief?
- What's the slot's role in the overall argument?

### Step 3: Identify Evidence Types Needed

What KINDS of evidence would fill this slot?

| Evidence Type | Examples |
|---------------|----------|
| Quantitative | Market data, statistics, percentages |
| Qualitative | Expert opinions, interview quotes |
| Temporal | Timeline events, before/after comparisons |
| Case-based | Specific examples, named instances |
| Comparative | X vs Y, alternative outcomes |
| Causal | Mechanism explanations, cause-effect chains |

**Aim for 2-4 evidence types per slot.**

### Step 4: Generate Search Queries

Convert the slot into specific, searchable queries.

| Bad Query | Good Query |
|-----------|------------|
| "Toyota EV problems" | "Toyota EV sales China 2024 market share" |
| "Why EVs fail" | "Toyota bZ4X recall technical issues" |
| "Leadership quotes" | "Akio Toyoda EV strategy statements 2023 2024" |

**Rules:**
- Include specific names, dates, metrics
- Use domain-appropriate terminology
- Generate 3-5 queries per slot
- Vary query angles (data, statements, examples)

---

## VAGUE SLOT HANDLING

Some slots are vague. Decompose them.

### Example: Vague Slot

```yaml
slot_id: AP_03
description: "Competitor comparison"
```

### Decomposition

```yaml
interpretation: |
  Need to compare Toyota's EV position against key competitors.
  Focus on metrics where Toyota is losing ground.

evidence_types_needed:
  - Market share data (quantitative)
  - Product launch timelines (temporal)
  - Technology comparisons (comparative)

search_queries:
  - "BYD vs Toyota EV sales 2024 China"
  - "Tesla Model Y vs Toyota bZ4X specifications"
  - "Chinese EV manufacturers global expansion 2024"
  - "Toyota EV product lineup vs competitors"

pressure_direction: |
  Evidence here pressures belief by showing Toyota falling behind.
  Competitors succeeding where Toyota hesitates.
```

---

## HANDLING research_so_far (OPTIONAL)

When `research_so_far` is provided, review what Discovery already found:

### Step 5: Review Provided Items

For each slot:
1. Count items from `research_so_far.discourse_items` that have this slot in `slot_relevance`
2. Note what's already covered vs gaps
3. Generate queries that GO DEEPER (not repeat what Discovery found)

```yaml
slot_queries:
  - slot_id: AP_01
    # ... existing fields ...

    # When research_so_far provided:
    provided_items_count: 3
    provided_coverage_notes: |
      Discovery found 3 items for this slot:
      - Market share statistics (2 items)
      - Expert quote (1 item)
      Gap: No temporal data (before/after comparison)

    search_queries:
      # Generate queries that fill gaps, not repeat
      - "Toyota EV market share trend 2020-2024"  # Temporal gap
      - "BYD vs Toyota growth rate comparison"    # Deeper than existing
```

### Query Enhancement

Use provided items to generate better queries:
- Extract key terms, author names, study names
- "More like this" searches
- Find primary sources for cited data
- Search for opposing viewpoints

**Do NOT simply re-search what Discovery found.**

---

## SLOT DEPENDENCY CHECK

Some slots may depend on others. Flag these.

```yaml
dependencies:
  - slot_id: AP_04
    depends_on: AP_01
    reason: "Internal challenges only make sense after establishing market decline"
```

This informs later ordering but doesn't block research.

---

## HARD CONSTRAINTS

- Every slot gets analyzed (no skipping)
- Vague slots MUST be decomposed
- Each slot gets 3-5 search queries minimum
- Queries must be specific and searchable
- Pressure direction must connect to belief

---

## COMPLETION RULE

You are done when:
- All slots have interpretation documented
- Evidence types identified for each slot
- 3-5 search queries per slot
- Pressure direction clear
- Dependencies flagged (if any)

---

## NEXT STEP

`slot_queries` → `steps/evidence_search.md`

Search queries drive the evidence search step.
