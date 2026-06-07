# Step 3: Narrative Gap Analysis

**Version:** 1.0
**Last Updated:** 2026-01-25

## Purpose

Identify missing narrative elements for a compelling YouTube story.

The current pipeline tests only for PROVE (advances logical collapse). A good YouTube story needs four narrative functions:

| Function | Test | Example |
|----------|------|---------|
| **PROVE** | Advances logical collapse | Data, mechanism, contradiction |
| **GROUND** | Makes it real | Victim story, character, specific moment |
| **IMPLICATE** | Puts viewer IN the story | "You saw this headline" |
| **LAND** | Creates weight/stillness at end | "Where are they now", "this isn't over" |

This step analyzes selected themes, identifies which functions are missing, and generates targeted research queries to fill gaps.

---

## Input

| Input | Source |
|-------|--------|
| `STEP2_selected_themes.yaml` | From Step 2 (theme_selection) |
| Belief statement | From discovery |
| Content class | `detonator` or `mirror` |

### Input Schema

```yaml
selected_themes:
  - theme_id: string
    name: string
    attacks_belief: string
    selected_items:
      - item_id: string
        content: string
        source: string
        reason: string
    discarded_items:
      - item_id: string
        reason: string

belief_statement: string
content_class: "detonator" | "mirror"
```

---

## Output

### `STEP3_narrative_gaps.yaml`

```yaml
narrative_gaps:
  function_coverage:
    PROVE:
      covered: true | false | partial
      strength: "strong" | "adequate" | "weak"
      themes: ["THEME_01", "THEME_02"]
      notes: string | null

    GROUND:
      covered: true | false | partial
      gap: string | null
      research_queries:
        - query: string
          purpose: string

    IMPLICATE:
      covered: true | false | partial
      gap: string | null
      research_queries:
        - query: string
          purpose: string

    LAND:
      covered: true | false | partial
      gap: string | null
      research_queries:
        - query: string
          purpose: string

  youtube_elements:
    hook_that_commits:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    forward_pull:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    escalation:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    specificity:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    someone_to_follow:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    the_turn:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    emotional_variation:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null
    the_landing:
      status: "covered" | "partial" | "MISSING"
      evidence: string | null
      gap: string | null

  research_queries:
    - query: string
      purpose: "GROUND" | "IMPLICATE" | "LAND"
      fills_gap: string
      priority: "critical" | "important" | "nice_to_have"

  summary:
    prove_coverage: "strong" | "adequate" | "weak"
    narrative_gaps_count: int
    critical_gaps: int
    research_queries_count: int
    ready_for_structure: true | false
```

---

## YouTube Narrative Elements Reference

A good YouTube story needs these eight elements:

| Element | Description | What to Look For |
|---------|-------------|------------------|
| **Hook that commits** | Stakes + gap in first 30 sec | Does an item create immediate stakes AND unanswered question? |
| **Forward pull** | Every 30 sec needs reason for next 30 sec | Do items chain? Does knowing X raise question Y? |
| **Escalation** | "Wait, it gets worse" | Do items build in severity, scale, or implication? |
| **Specificity** | Numbers, names, moments - not abstractions | Do items have concrete details ($14,810, Kevin Sneader, June 2021)? |
| **Someone to follow** | Character (villain or victim) | Is there a person whose story we track? |
| **The turn** | Viewer's assumption breaks | Is there a moment where what viewer assumed flips? |
| **Emotional variation** | Peaks and valleys | Do items create different emotional registers? |
| **The landing** | Resonates, doesn't just conclude | Does final beat create weight, not just summary? |

### For Investigative/Expose Content

Additional elements to check:

| Element | Purpose | Research Signal |
|---------|---------|-----------------|
| "You were fooled" moment | IMPLICATE | Did viewer see the original headline? The settlement announcement? |
| "This isn't over" | LAND | Current status, ongoing harm, future implications |
| Villain with face | GROUND | Named individual whose decisions drove harm |
| Victim with face | GROUND | Named individual who suffered consequences |

---

## Process

### Step 1: Inventory Current Material

For each selected theme, list:
- What specific claims/facts does this theme contain?
- What characters (if any) appear?
- What emotional register does this theme create?

Create an inventory:
```yaml
material_inventory:
  characters:
    villains: ["name1", "name2"]
    victims: []
    authorities: ["name3"]

  specifics:
    numbers: ["$14,810", "$650M"]
    dates: ["June 2021"]
    places: ["Boston office"]

  emotional_registers:
    - theme: "THEME_01"
      register: "irony"
    - theme: "THEME_02"
      register: "outrage"
```

### Step 2: Assess PROVE Coverage

PROVE is the baseline - selected themes should already provide this.

Check:
- Do themes collectively advance belief collapse?
- Is the logical chain complete?
- Are there gaps in the argument?

Rate as:
- **strong**: Clear, complete logical collapse
- **adequate**: Logical chain present but could be tighter
- **weak**: Gaps in logic that need addressing

### Step 3: Assess GROUND Coverage

GROUND makes abstract harm concrete through people and moments.

Check:
- Is there a victim whose story we can follow?
- Is there a villain whose decisions we can trace?
- Are there specific moments (not just patterns)?

If missing:
```yaml
GROUND:
  covered: false
  gap: "No victim story - we have corporate data but no human face"
  research_queries:
    - query: "[topic] victim family story testimony"
      purpose: "Find named victim to make harm concrete"
```

### Step 4: Assess IMPLICATE Coverage

IMPLICATE puts the viewer IN the story - they were part of this.

Check:
- Did the viewer see the original news coverage?
- Did the viewer believe the narrative being debunked?
- Can we show the viewer they were fooled too?

If missing:
```yaml
IMPLICATE:
  covered: false
  gap: "No 'you were fooled' moment - viewer as bystander, not participant"
  research_queries:
    - query: "[topic] headline news coverage [publication] [year]"
      purpose: "Find headlines viewer would have seen"
```

### Step 5: Assess LAND Coverage

LAND creates weight at the end - this matters NOW.

Check:
- Do we know what happened to key figures?
- Is there ongoing harm or unresolved tension?
- Can we create "this isn't over" urgency?

If missing:
```yaml
LAND:
  covered: false
  gap: "No 'where are they now' - story feels historical, not urgent"
  research_queries:
    - query: "[key figure] current position [year]"
      purpose: "Find current status to create urgency"
```

### Step 6: Map to YouTube Elements

For each of the 8 YouTube narrative elements:

1. Check if current material satisfies it
2. If not, identify what's missing
3. Link to narrative function (PROVE/GROUND/IMPLICATE/LAND)

```yaml
youtube_elements:
  someone_to_follow:
    status: "MISSING"
    evidence: null
    gap: "No victim character - only corporate entities"
    maps_to_function: "GROUND"
```

### Step 7: Generate Research Queries

For each gap, generate specific research queries.

Query quality rules:
- **Specific**: Include names, dates, publications
- **Searchable**: Use terms that appear in news/documents
- **Bounded**: Target facts, not interpretations

Good query examples:
- "Kevin Sneader current job 2025 2026" (specific, recent)
- "McKinsey $650M settlement headline NYT WSJ 2021" (publication, year)
- "Purdue opioid victim family testimony congress" (context, venue)

Bad query examples:
- "McKinsey bad behavior" (too vague)
- "Why did McKinsey help Purdue" (interpretation, not fact)
- "Corporate accountability" (abstract, not specific)

### Step 8: Prioritize Gaps

Assign priority:

| Priority | Criteria |
|----------|----------|
| **critical** | Story fundamentally incomplete without this |
| **important** | Story significantly stronger with this |
| **nice_to_have** | Would enhance but not essential |

Rules:
- At least one GROUND element is **critical** for expose content
- IMPLICATE is **important** for detonator class
- LAND is **important** for creating urgency

### Step 9: Determine Structure Readiness

```yaml
ready_for_structure: true | false
```

TRUE if:
- PROVE is adequate or strong
- At least one GROUND element exists (or critical query generated)
- No more than 2 critical gaps

FALSE if:
- PROVE is weak
- No GROUND elements AND no character material at all
- More than 2 critical gaps

---

## Hard Constraints

- PROVE coverage comes from selected themes - do NOT generate PROVE research queries
- Research queries target FACTS, not interpretations
- Each query must map to a specific narrative function
- Queries must be specific enough to execute (names, dates, publications)
- Do NOT fabricate gaps - only identify genuine missing elements
- Maximum 5 research queries (focus on critical/important)

---

## Common Gap Patterns

### Expose/Investigative Content

| Common Gap | Function | Typical Query |
|------------|----------|---------------|
| No victim face | GROUND | "[company] victim family testimony story" |
| No villain face | GROUND | "[executive name] decisions internal documents" |
| No "you were fooled" | IMPLICATE | "[settlement/event] headline news [year]" |
| No current status | LAND | "[key figure] current position [year]" |
| No ongoing harm | LAND | "[issue] current status continuing [year]" |

### Mirror-Class Content

| Common Gap | Function | Typical Query |
|------------|----------|---------------|
| No concrete example | GROUND | "[pattern] specific case example" |
| No viewer connection | IMPLICATE | "[topic] affects you how" |
| No open tension | LAND | "[issue] unresolved questions" |

---

## Output Example

```yaml
narrative_gaps:
  function_coverage:
    PROVE:
      covered: true
      strength: "strong"
      themes: ["THEME_01", "THEME_02", "THEME_03", "THEME_04"]
      notes: "Clear logical chain from payment structure to outcome"

    GROUND:
      covered: false
      gap: "No victim story - corporate data but no human face on the harm"
      research_queries:
        - query: "opioid overdose victim family McKinsey Purdue testimony"
          purpose: "Find named victim to make harm concrete"
        - query: "McKinsey consultant opioid project who worked on it names"
          purpose: "Find individual villains beyond 'McKinsey'"

    IMPLICATE:
      covered: false
      gap: "No 'you saw this headline' moment - viewer as observer not participant"
      research_queries:
        - query: "McKinsey $650M settlement headline NYT WSJ coverage 2021"
          purpose: "Find headlines viewer would have seen and believed"

    LAND:
      covered: partial
      gap: "Settlement mentioned but no 'where are they now' for key figures"
      research_queries:
        - query: "Kevin Sneader current position 2025 2026"
          purpose: "Show what happened to executive who apologized"

  youtube_elements:
    hook_that_commits:
      status: "covered"
      evidence: "THEME_01: $14,810 per overdose death creates immediate stakes"
      gap: null
    forward_pull:
      status: "covered"
      evidence: "Themes chain: payment structure -> internal knowledge -> settlement theater"
      gap: null
    escalation:
      status: "covered"
      evidence: "THEME_03 'settlement paradox' is clear escalation from THEME_01"
      gap: null
    specificity:
      status: "covered"
      evidence: "$14,810, $650M, Kevin Sneader, Martin Elling - concrete details present"
      gap: null
    someone_to_follow:
      status: "MISSING"
      evidence: null
      gap: "No victim character - only corporate entities and executives"
    the_turn:
      status: "covered"
      evidence: "THEME_04 'punished for apologizing' inverts expectation"
      gap: null
    emotional_variation:
      status: "partial"
      evidence: "Outrage (THEME_01) and irony (THEME_04) present"
      gap: "Missing: grief, hope, resolution"
    the_landing:
      status: "MISSING"
      evidence: null
      gap: "Ends on settlement - no weight, no 'this isn't over'"

  research_queries:
    - query: "opioid overdose victim family McKinsey Purdue testimony"
      purpose: "GROUND"
      fills_gap: "No victim character"
      priority: "critical"
    - query: "Kevin Sneader current position 2025 2026"
      purpose: "LAND"
      fills_gap: "No 'where are they now'"
      priority: "important"
    - query: "McKinsey $650M settlement headline NYT WSJ coverage 2021"
      purpose: "IMPLICATE"
      fills_gap: "No 'you saw this' moment"
      priority: "important"

  summary:
    prove_coverage: "strong"
    narrative_gaps_count: 4
    critical_gaps: 1
    research_queries_count: 3
    ready_for_structure: true
```

---

## Completion Rule

You are done when:
- All four narrative functions assessed (PROVE, GROUND, IMPLICATE, LAND)
- All eight YouTube elements evaluated
- Gaps identified with specific descriptions
- Research queries generated for each gap (max 5)
- Priorities assigned
- Structure readiness determined
- `STEP3_narrative_gaps.yaml` complete

---

## Next Step

`STEP3_narrative_gaps.yaml` -> `steps/4_targeted_research.md`

Research queries are executed to fill gaps before proceeding to arc building.
