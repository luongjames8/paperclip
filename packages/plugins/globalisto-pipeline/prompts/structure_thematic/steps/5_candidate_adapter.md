# Step 5: Candidate Unit Adapter

**Version:** 2.0
**Last Updated:** 2026-03-18

## Purpose

Convert thematic selections into `candidate_units.yaml` — the format expected by retention structure design.

This is a PURE ADAPTER step. It combines:
- **Selected themes** (from theme_selection) - the PROVE material organized by theme
- **Narrative material** (from targeted_research) - GROUND, IMPLICATE, LAND items

And outputs `candidate_units.yaml` ONLY. Retention structure design, ordering, loops, arc phases, and BEAT_GRAPH generation happen in subsequent steps.

---

## Input

| Input | Source |
|-------|--------|
| `STEP2_selected_themes.yaml` | From Step 2 (theme_selection) |
| `STEP4_narrative_material.yaml` | From Step 4 (targeted_research) |
| `belief_statement` | From discovery |
| `content_class` | `detonator` or `mirror` |

### Input Schema: STEP2_selected_themes.yaml

```yaml
selected_themes:
  - theme_id: "THEME_01"
    name: "Punished for Apologizing"
    attacks_belief: "Getting fired means disgrace"
    emotional_register: "irony"
    selected_items:
      - item_id: "PB_32"
        content: "Kevin Sneader was ousted as global managing partner in 2021..."
        source: "NYT, 2021"
        original_role: core
        reason: "Establishes the firing - core setup"
      - item_id: "PB_36"
        content: "Sneader later defended Martin Elling in court..."
        source: "Court filings, 2024"
        original_role: supporting
        reason: "The twist - defends the convict"
    discarded_items:
      - item_id: "PB_33"
        reason: "Redundant with PB_32"

selection_summary:
  themes_in: 5
  themes_out: 4
  items_selected: 11
  items_discarded: 34
  discard_rate: 0.76
```

### Input Schema: STEP4_narrative_material.yaml

```yaml
narrative_material:
  items:
    - id: "NM_01"
      function: "GROUND"
      fills_gap: "No victim character"
      content: "Jennifer Weiss-Burke lost her son to opioid overdose in 2012. He was 18."
      specifics:
        names: ["Jennifer Weiss-Burke"]
        numbers: ["18"]
        dates: ["2012"]
        places: []
      emotional_register: "grief"
      source:
        id: "NS_01"
        type: "testimony"
        title: "Congressional Testimony on Opioid Crisis"
        url: "https://..."
        date: "2019"
        credibility: "high"

    - id: "NM_02"
      function: "IMPLICATE"
      fills_gap: "No 'you saw this' moment"
      content: "Headline: 'McKinsey Reaches $650 Million Settlement Over Role in Opioid Crisis'"
      specifics:
        names: ["McKinsey"]
        numbers: ["$650 Million"]
        dates: ["Feb 2021"]
        places: []
      emotional_register: "recognition"
      source:
        id: "NS_02"
        type: "news"
        title: "NYT Coverage of McKinsey Settlement"
        url: "https://..."
        date: "2021-02"
        credibility: "high"

    - id: "NM_03"
      function: "LAND"
      fills_gap: "No 'where are they now'"
      content: "Kevin Sneader is now co-president of CICC, China's largest investment bank"
      specifics:
        names: ["Kevin Sneader", "CICC"]
        numbers: []
        dates: ["2023"]
        places: ["China"]
      emotional_register: "stillness"
      source:
        id: "NS_03"
        type: "news"
        title: "CICC Leadership Announcement"
        url: "https://..."
        date: "2023"
        credibility: "high"

  sources:
    - id: "NS_01"
      type: "testimony"
      title: "Congressional Testimony on Opioid Crisis"
      url: "https://..."
      date: "2019"
      credibility: "high"
    # ... additional sources

  summary:
    queries_executed: 3
    items_found: 3
    functions_filled:
      GROUND: true
      IMPLICATE: true
      LAND: true
```

---

## Output

### `candidate_units.yaml`

This must match the input schema expected by `retention_structure.md`:

```yaml
candidate_units:
  selection_mode: "thematic"  # Indicates thematic pathway was used

  units:
    - unit_id: "UNIT_001"
      derived_from: ["PB_32", "PB_36"]  # item_ids from selected_themes
      theme_id: "THEME_01"  # Which theme this unit represents
      theme_name: "Punished for Apologizing"
      description: "Sneader ousted for apologizing, then defended convicted colleague"
      pressure_applied: "Challenges 'getting fired = disgrace' - shows firing was for showing remorse"
      evidence_confidence: high
      emotional_register: "irony"
      hook_strength: "HIGH" | "MEDIUM" | "LOW"
      narrative_function: "PROVE"  # All theme items serve PROVE function
      content_items:
        - item_id: "PB_32"
          content: "Kevin Sneader was ousted as global managing partner..."
          source: "NYT, 2021"
        - item_id: "PB_36"
          content: "Sneader later defended Martin Elling..."
          source: "Court filings, 2024"

    - unit_id: "UNIT_005"
      derived_from: ["NM_01"]  # From narrative_material
      theme_id: null  # Narrative material is not from themes
      theme_name: null
      description: "Victim story - Jennifer Weiss-Burke's son"
      pressure_applied: "Makes abstract death count concrete through single story"
      evidence_confidence: high
      emotional_register: "grief"
      hook_strength: "MEDIUM"
      narrative_function: "GROUND"
      content_items:
        - item_id: "NM_01"
          content: "Jennifer Weiss-Burke lost her son to opioid overdose..."
          source: "Congressional testimony, 2019"

hook_zone:
  strength: "HIGH" | "MEDIUM" | "LOW"
  stakes:
    what: "[What's at stake - derived from strongest theme]"
    for_whom: "[Who faces consequences]"
    why_now: "[Urgency]"
  curiosity_gap:
    known: "[What viewer thinks they know]"
    unknown: "[What they'll discover]"
    tension: "[The question that drives forward]"

content_class: "detonator" | "mirror"

force_of_opposition:
  type: "central_misconception" | "counterintuitive_truth" | "hidden_mechanism"
  statement: "[The belief being challenged - from discovery]"
  why_strong: "[Why this belief is compelling/hard to shake]"

transformation_summary:
  themes_converted: 4
  narrative_items_added: 3
  total_units: 7
  units_by_function:
    PROVE: 4
    GROUND: 1
    IMPLICATE: 1
    LAND: 1
```

---

## Transformation Rules

### Rule 1: One Theme = One Unit

Each selected theme becomes ONE structural unit, regardless of how many items it contains.

**Why:** Themes are conceptual units. The items within a theme support that concept. In retention structure, the theme IS the beat - the items are the evidence within that beat.

```yaml
# Theme with 2 items -> 1 unit with 2 content_items
THEME_01 (items: PB_32, PB_36) -> UNIT_001 (content_items: [PB_32, PB_36])
```

### Rule 2: Narrative Material = Separate Units

Each item from `narrative_material.items` becomes its own unit.

**Why:** GROUND, IMPLICATE, and LAND items serve distinct narrative functions that need their own beats in the retention structure.

```yaml
NM_01 (GROUND) -> UNIT_005
NM_02 (IMPLICATE) -> UNIT_006
NM_03 (LAND) -> UNIT_007
```

### Rule 3: Assign Hook Strength

For each unit, assess hook_strength based on:

| Criteria | HIGH | MEDIUM | LOW |
|----------|------|--------|-----|
| Stakes clarity | Immediate, visceral | Clear but abstract | Unclear |
| Specificity | Precise numbers/names | General claims | Vague |
| Curiosity gap | Strong question raised | Some intrigue | Informational only |
| Emotional impact | Strong reaction | Moderate reaction | Neutral |

**Theme-based units:** Use the strongest item's hook potential
**GROUND units:** Usually HIGH (human stories hook)
**IMPLICATE units:** Usually HIGH (viewer involvement hooks)
**LAND units:** Usually MEDIUM (resolution, not hook)

### Rule 4: Derive Hook Zone from Strongest Unit

The `hook_zone` section is derived from whichever unit has the highest hook_strength (likely HOOK or theme with strongest opening).

Assess:
- **stakes**: What's at risk, for whom, why now
- **curiosity_gap**: What's known vs unknown, the driving question

### Rule 5: Carry Forward Force of Opposition

The `force_of_opposition` comes directly from discovery/belief statement:

```yaml
force_of_opposition:
  type: "central_misconception"  # Usually for detonator
  statement: "[belief statement from discovery]"
  why_strong: "[from discovery - why people hold this belief]"
```

---

## Process

### Step 1: Convert Themes to Units

For each theme in `selected_themes`:

```yaml
- unit_id: "UNIT_[sequential]"
  derived_from: [list of item_ids in theme]
  theme_id: "[theme_id]"
  theme_name: "[theme name]"
  description: "[one-sentence summary of what theme conveys]"
  pressure_applied: "[from attacks_belief]"
  evidence_confidence: high | medium  # based on sources
  emotional_register: "[from theme]"
  hook_strength: "[assess using Rule 3]"
  narrative_function: "PROVE"
  content_items:
    - item_id: "[ID]"
      content: "[content]"
      source: "[source]"
```

### Step 2: Convert Narrative Material to Units

For each item in `narrative_material.items`:

```yaml
- unit_id: "UNIT_[sequential]"
  derived_from: ["[NM_id]"]
  theme_id: null
  theme_name: null
  description: "[from content - what this item provides]"
  pressure_applied: "[how this affects the narrative]"
  evidence_confidence: high | medium
  emotional_register: "[assess based on function]"
  hook_strength: "[assess using Rule 3]"
  narrative_function: "[from function field: GROUND|IMPLICATE|LAND]"
  content_items:
    - item_id: "[NM_id]"
      content: "[content]"
      source: "[source]"
```

### Step 3: Identify Strongest Hook Unit

1. Review all units for hook_strength
2. Identify unit with highest hook potential
3. This unit should open L_MAIN in retention_structure

Mark in output:
```yaml
hook_candidate:
  unit_id: "UNIT_001"
  hook_strength: "HIGH"
  reason: "Specific dollar figure + death creates immediate stakes"
```

### Step 4: Build Hook Zone

From the hook candidate unit, derive:

```yaml
hook_zone:
  strength: "[hook_strength of hook candidate]"
  stakes:
    what: "[extract from unit's pressure_applied]"
    for_whom: "[identify affected party]"
    why_now: "[derive urgency]"
  curiosity_gap:
    known: "[what viewer assumes]"
    unknown: "[what unit will reveal]"
    tension: "[the question]"
```

### Step 5: Set Force of Opposition

From discovery inputs:

```yaml
force_of_opposition:
  type: "[assess: misconception|counterintuitive|mechanism]"
  statement: "[belief_statement]"
  why_strong: "[why this belief persists]"
```

### Step 6: Compile Output

Assemble complete `candidate_units.yaml` with all sections.

---

## Emotional Register Mapping

When converting narrative_material to units, assign emotional_register based on function:

| Function | Typical Registers |
|----------|-------------------|
| GROUND | grief, empathy, connection, weight |
| IMPLICATE | recognition, discomfort, complicity |
| LAND | stillness, resolution, urgency, weight |

---

## Hook Strength Assessment Examples

### HIGH Hook Strength

```yaml
# Specific number + death
description: "$14,810 per overdose death - McKinsey's payment per casualty"
hook_strength: "HIGH"
reason: "Precise dollar figure linked to deaths creates immediate visceral reaction"

# Victim with face
description: "Jennifer lost her 18-year-old son to opioids"
hook_strength: "HIGH"
reason: "Named person, specific age, concrete loss - human story hooks"

# You were fooled
description: "You saw the $650M settlement headline and thought justice was done"
hook_strength: "HIGH"
reason: "Implicates viewer directly - they were wrong"
```

### MEDIUM Hook Strength

```yaml
# Good claim, less specific
description: "McKinsey advised Purdue to 'turbocharge' sales"
hook_strength: "MEDIUM"
reason: "Clear wrongdoing but language is quoted, not quantified"

# Where are they now
description: "Kevin Sneader is now co-president of China's largest investment bank"
hook_strength: "MEDIUM"
reason: "Resolution information, not opening hook material"
```

### LOW Hook Strength

```yaml
# Background context
description: "Opioid crisis began in the 1990s with overprescription"
hook_strength: "LOW"
reason: "General context, no specific stake or question raised"

# Abstract claim
description: "McKinsey's consulting practices enabled harm"
hook_strength: "LOW"
reason: "Vague, no specificity, no immediate question"
```

---

## Hard Constraints

- Each theme becomes exactly ONE unit
- Each narrative_material item becomes exactly ONE unit
- All units MUST have hook_strength assigned
- narrative_function MUST be set for all units (PROVE for themes, actual function for NM items)
- hook_zone MUST be derived from actual unit content (not fabricated)
- force_of_opposition MUST match discovery belief statement
- Do NOT add units beyond themes + narrative_material
- Do NOT merge narrative_material items into theme units

---

## Validation Checklist

Before output:

**candidate_units.yaml:**
- [ ] Unit count = theme count + narrative_material.items count
- [ ] All units have unique unit_id
- [ ] All units have hook_strength (HIGH/MEDIUM/LOW)
- [ ] All units have narrative_function (PROVE/GROUND/IMPLICATE/LAND)
- [ ] At least one unit has hook_strength HIGH (for hook position)
- [ ] hook_zone.strength matches hook candidate's hook_strength
- [ ] force_of_opposition.statement matches belief_statement input
- [ ] content_class is set correctly
- [ ] selection_mode is "thematic"

---

## Output Example

```yaml
candidate_units:
  selection_mode: "thematic"

  units:
    # Theme-derived units (PROVE function)
    - unit_id: "UNIT_001"
      derived_from: ["PB_07", "PB_12"]
      theme_id: "THEME_02"
      theme_name: "Horror is Banal"
      description: "$14,810 per overdose death calculated in Excel spreadsheets"
      pressure_applied: "This wasn't aberrant - it was methodical, calculated, normal"
      evidence_confidence: high
      emotional_register: "cold precision"
      hook_strength: "HIGH"
      narrative_function: "PROVE"
      content_items:
        - item_id: "PB_07"
          content: "McKinsey calculated a payment of $14,810 per overdose death..."
          source: "Massachusetts AG filing, 2021"
        - item_id: "PB_12"
          content: "Consultants used Excel to model death projections..."
          source: "Internal documents, court exhibit"

    - unit_id: "UNIT_002"
      derived_from: ["PB_32", "PB_36"]
      theme_id: "THEME_01"
      theme_name: "Punished for Apologizing"
      description: "CEO fired for showing remorse, later defended convicted colleague"
      pressure_applied: "Getting fired wasn't disgrace - the apology was the problem"
      evidence_confidence: high
      emotional_register: "irony"
      hook_strength: "MEDIUM"
      narrative_function: "PROVE"
      content_items:
        - item_id: "PB_32"
          content: "Kevin Sneader was ousted as global managing partner in 2021..."
          source: "NYT, 2021"
        - item_id: "PB_36"
          content: "Sneader later defended Martin Elling in court..."
          source: "Court filings, 2024"

    - unit_id: "UNIT_003"
      derived_from: ["PB_18", "PB_21"]
      theme_id: "THEME_03"
      theme_name: "Settlement Paradox"
      description: "$650M settlement with no admission of wrongdoing, charges dropped"
      pressure_applied: "Payment wasn't punishment - it was purchase of closure"
      evidence_confidence: high
      emotional_register: "outrage"
      hook_strength: "HIGH"
      narrative_function: "PROVE"
      content_items:
        - item_id: "PB_18"
          content: "McKinsey paid $650M in the largest consulting settlement..."
          source: "DOJ announcement, 2021"
        - item_id: "PB_21"
          content: "The settlement included no admission of wrongdoing..."
          source: "Settlement documents"

    - unit_id: "UNIT_004"
      derived_from: ["PB_25", "PB_28"]
      theme_id: "THEME_04"
      theme_name: "Cover-up > Crime"
      description: "Elling got 6 months for destroying emails; architects untouched"
      pressure_applied: "Justice targeted the cover-up, not the crime"
      evidence_confidence: high
      emotional_register: "frustration"
      hook_strength: "MEDIUM"
      narrative_function: "PROVE"
      content_items:
        - item_id: "PB_25"
          content: "Martin Elling was sentenced to 6 months for obstruction..."
          source: "DOJ, 2024"
        - item_id: "PB_28"
          content: "No charges were brought against consultants who designed..."
          source: "Court records"

    # Narrative material units (non-PROVE functions)
    - unit_id: "UNIT_005"
      derived_from: ["NM_01"]
      theme_id: null
      theme_name: null
      description: "Jennifer Weiss-Burke lost her 18-year-old son to opioid overdose"
      pressure_applied: "Makes abstract death count concrete through one family's loss"
      evidence_confidence: high
      emotional_register: "grief"
      hook_strength: "HIGH"
      narrative_function: "GROUND"
      content_items:
        - item_id: "NM_01"
          content: "Jennifer Weiss-Burke lost her son to opioid overdose in 2012..."
          source: "Congressional testimony, 2019"

    - unit_id: "UNIT_006"
      derived_from: ["NM_02"]
      theme_id: null
      theme_name: null
      description: "You saw the $650M settlement headline and thought justice was done"
      pressure_applied: "Implicates viewer - they believed the narrative being debunked"
      evidence_confidence: high
      emotional_register: "recognition"
      hook_strength: "HIGH"
      narrative_function: "IMPLICATE"
      content_items:
        - item_id: "NM_02"
          content: "Headline: 'McKinsey Reaches $650 Million Settlement Over Role in Opioid Crisis'"
          source: "NYT, Feb 2021"

    - unit_id: "UNIT_007"
      derived_from: ["NM_03"]
      theme_id: null
      theme_name: null
      description: "Kevin Sneader is now co-president of China's largest investment bank"
      pressure_applied: "Creates 'this isn't over' - consequences didn't stick"
      evidence_confidence: high
      emotional_register: "stillness"
      hook_strength: "MEDIUM"
      narrative_function: "LAND"
      content_items:
        - item_id: "NM_03"
          content: "Kevin Sneader is now co-president of CICC..."
          source: "CICC announcement, 2023"

  hook_candidate:
    unit_id: "UNIT_001"
    hook_strength: "HIGH"
    reason: "Specific dollar figure per death creates immediate visceral stakes"

hook_zone:
  strength: "HIGH"
  stakes:
    what: "McKinsey was paid per overdose death"
    for_whom: "Hundreds of thousands of opioid victims"
    why_now: "The executives faced no real consequences"
  curiosity_gap:
    known: "McKinsey settled for $650M - you thought that was accountability"
    unknown: "How they got paid per death and where they are now"
    tension: "How did this payment structure even exist, and what happened to them?"

content_class: "detonator"

force_of_opposition:
  type: "central_misconception"
  statement: "McKinsey paid $650M and was held accountable for the opioid crisis"
  why_strong: "Settlement made headlines, dollar amount feels like punishment, case closed"

transformation_summary:
  themes_converted: 4
  narrative_items_added: 3
  total_units: 7
  units_by_function:
    PROVE: 4
    GROUND: 1
    IMPLICATE: 1
    LAND: 1
```


---

## Completion Rule

You are done when:
- All themes from `STEP2_selected_themes.yaml` converted to units
- All items from `STEP4_narrative_material.yaml` converted to units
- Each unit has all required fields populated
- hook_strength assigned to all units based on assessment criteria
- hook_zone derived from actual hook candidate content
- force_of_opposition matches discovery belief
- Validation checklist passes
- `candidate_units.yaml` complete

**Do NOT generate BEAT_GRAPH.yaml or BLUEPRINT.md** — those are produced by downstream steps after retention structure design and ordering.

---

## Next Step

`candidate_units.yaml` → `structure/steps/3_retention_structure.md` (retention structure design with arc phases, loops, tension chains, and causal ordering)
