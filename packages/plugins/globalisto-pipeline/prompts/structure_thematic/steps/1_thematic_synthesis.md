# STEP 1: THEMATIC SYNTHESIS

## PURPOSE

Group research items into thematic clusters BEFORE selection.

This step answers: "What themes emerge naturally from the research, and which items belong to each theme?"

**KEY DIFFERENCE FROM CLASSIFICATION:**
- Classification asks: "Does removing this break belief collapse?"
- Thematic synthesis asks: "What themes emerge across all material, and how do items cluster?"

The belief-collapse test optimizes for ARGUMENT (minimum to prove). Thematic synthesis optimizes for STORY (what makes good YouTube narrative).

---

## INPUT

| Input | Source |
|-------|--------|
| `POTENTIAL_BEATS.yaml` | All research items from research module |
| `belief` | The belief statement being addressed |

### Input Schema

```yaml
# POTENTIAL_BEATS.yaml structure
belief: "[The belief statement]"

potential_beats:
  - id: PB_XX
    slot_id: AP_XX
    description: "[what this item conveys]"
    belief_pressure: "[how this item applies pressure]"
    type: reveal | escalation | contradiction | irony | origin
    evidence_refs: [EV_XXX]
    source: fresh_research | existing
```

---

## OUTPUT

### `STEP1_themes.yaml`

```yaml
themes:
  - theme_id: "THEME_01"
    name: "[Verb phrase - specific, not generic]"
    attacks_belief: "[What aspect of audience default model this theme challenges]"
    emotional_register: "[Primary emotional tone: irony | outrage | sadness | revelation | absurdity]"
    theme_summary: "[2-3 sentence description of what this theme reveals]"
    items:
      - item_id: "PB_XX"
        role: core | supporting
        contribution: "[How this item serves the theme]"
      - item_id: "PB_YY"
        role: core | supporting
        contribution: "[How this item serves the theme]"

orphaned_items:
  - item_id: "PB_ZZ"
    reason: "[Why this doesn't fit any theme]"
    potential_use: "[e.g., 'background context', 'possible enrichment later']"

synthesis_metadata:
  total_items_input: [N]
  items_assigned: [N]
  items_orphaned: [N]
  theme_count: [N]

validation:
  all_items_assigned_once: true | false
  themes_distinct: true | false
  minimum_theme_count_met: true | false  # Must be >= 3
  maximum_theme_count_met: true | false  # Must be <= 6
  all_themes_have_minimum_items: true | false  # Each theme >= 2 items
```

---

## THEME REQUIREMENTS

### Theme Names Must Be Specific

| BAD (Generic) | GOOD (Specific) |
|---------------|-----------------|
| "Corporate Greed" | "Punished for Apologizing" |
| "Lack of Accountability" | "Cover-up Bigger Than Crime" |
| "Systemic Failure" | "The Settlement Paradox" |
| "Corruption" | "Horror is Banal" |
| "Injustice" | "Charged for Proposal, Not Execution" |

**Test:** If the theme name could apply to 100 different stories, it's too generic. A good theme name captures something SPECIFIC about THIS story.

### Theme Must Attack a Belief

Each theme must challenge a specific aspect of what the audience likely believes before watching. Examples:

| Theme | Attacks Belief |
|-------|---------------|
| "Horror is Banal" | "This was aberrant behavior by bad actors" |
| "Punished for Apologizing" | "Getting fired from a top position is shameful" |
| "Cover-up > Crime" | "The justice system targets masterminds" |
| "The Settlement Paradox" | "Large settlements mean accountability happened" |

### Emotional Register

Each theme has a dominant emotional quality:

| Register | Description | Example |
|----------|-------------|---------|
| irony | Outcome contradicts expectation | Leader fired for doing right thing |
| outrage | Violation of moral standards | Calculated price on human overdoses |
| sadness | Loss, tragedy, human cost | Victims never saw justice |
| revelation | Hidden truth exposed | Documents show explicit calculations |
| absurdity | Logic breaks down | Convicted for email, not deaths |

---

## ITEM ROLES WITHIN THEMES

| Role | Meaning | Typical Count |
|------|---------|---------------|
| **core** | Essential to establishing theme | 2-3 per theme |
| **supporting** | Reinforces or adds texture to theme | 1-3 per theme |

**Core items:** Without these, the theme doesn't land. They carry the primary weight.

**Supporting items:** These add depth, variation, or evidence. Theme still works without them, but weaker.

---

## UNIQUENESS RULE (MANDATORY)

**Each item belongs to exactly ONE theme.**

If an item seems to fit two themes:
1. Determine which theme it serves MORE directly
2. Assign it to that theme only
3. If truly equal, the themes may be too similar - consider merging

**Test:** Can you articulate why this item belongs to Theme A rather than Theme B? If not, themes may overlap.

---

## DISTINCTNESS RULE (MANDATORY)

**Themes must be distinct from each other.**

Two themes are distinct if:
- They attack DIFFERENT beliefs, OR
- They use DIFFERENT emotional registers, OR
- They approach the story from DIFFERENT angles

**Merge signal:** If items could swap between themes without loss of meaning, the themes aren't distinct enough.

---

## PROCESS

### Step 1: Read All Items Holistically

**Do NOT classify slot-by-slot.** Read all items in `POTENTIAL_BEATS.yaml` as a whole.

Ask: "What patterns, clusters, or themes emerge across this material?"

Note initial impressions before grouping.

### Step 2: Identify Candidate Themes

List 4-8 candidate themes that seem to emerge. For each:
- Draft a specific name (verb phrase)
- Identify what belief it attacks
- Note the emotional register

### Step 3: Assign Items to Themes

For each item in `potential_beats`:
1. Which theme does this serve most directly?
2. Is it core (essential) or supporting (adds depth)?
3. Document the contribution

### Step 4: Validate Uniqueness

Check: Does any item appear in multiple themes?
- If YES: Reassign to the theme it serves better
- If items keep appearing in multiple: Themes may need merging

### Step 5: Validate Distinctness

For each pair of themes:
- Are they attacking different beliefs?
- Do they have different emotional registers?
- Could items swap between them without loss?

If themes overlap significantly: MERGE them.

### Step 6: Handle Orphans

Some items may not fit any theme. This is acceptable for:
- Background context
- Counter-evidence (may be handled separately)
- Items that don't carry enough weight for a theme

Document orphaned items with reasons.

### Step 7: Final Theme Count Check

- Minimum: 3 themes
- Maximum: 6 themes

If fewer than 3: Themes may be too granular - look for super-themes.
If more than 6: Themes may be too specific - look for natural merges.

---

## HARD CONSTRAINTS

| Constraint | Validation |
|------------|------------|
| Each item assigned to exactly ONE theme | `all_items_assigned_once: true` |
| Themes must be distinct | `themes_distinct: true` |
| Minimum 3 themes | `minimum_theme_count_met: true` |
| Maximum 6 themes | `maximum_theme_count_met: true` |
| Each theme has at least 2 items | `all_themes_have_minimum_items: true` |
| Theme names are specific (not generic) | Manual check |
| Each theme attacks a stated belief | `attacks_belief` field populated |

---

## VALIDATION CHECKLIST

Before completing output, verify:

- [ ] All items from `POTENTIAL_BEATS.yaml` accounted for (assigned or orphaned)
- [ ] No item appears in more than one theme
- [ ] Theme count is 3-6
- [ ] Each theme has 2+ items
- [ ] Theme names are specific, not generic
- [ ] Each theme has `attacks_belief` populated
- [ ] Each theme has `emotional_register` assigned
- [ ] Orphaned items have documented reasons
- [ ] All validation flags are true (or issues documented)

---

## EXAMPLE OUTPUT

```yaml
themes:
  - theme_id: "THEME_01"
    name: "Horror is Banal"
    attacks_belief: "This was aberrant behavior by a few bad actors"
    emotional_register: "revelation"
    theme_summary: |
      McKinsey didn't propose overdose rebates in a dark room - they used standard
      business tools: Excel spreadsheets, precise dollar figures ($14,810), and
      established rebate mechanisms. The horror wasn't the exception; it was the process.
    items:
      - item_id: "PB_01"
        role: core
        contribution: "The $14,810 figure - precision reveals calculation, not accident"
      - item_id: "PB_05"
        role: core
        contribution: "Chain-specific overdose projections show operational detail"
      - item_id: "PB_17"
        role: supporting
        contribution: "CVS customer overdose count (2,484) adds scale to the calculation"

  - theme_id: "THEME_02"
    name: "Punished for Apologizing"
    attacks_belief: "Getting fired from a top firm is shameful"
    emotional_register: "irony"
    theme_summary: |
      Kevin Sneader was ousted not for enabling the opioid crisis but for apologizing
      for it. Partners saw his apologies as weakness, loss of independence. Then he
      defended the convicted document-destroyer at sentencing.
    items:
      - item_id: "PB_32"
        role: core
        contribution: "Partners voted out Sneader after one term"
      - item_id: "PB_33"
        role: core
        contribution: "Reason: dissatisfaction with his apologies"
      - item_id: "PB_36"
        role: supporting
        contribution: "Sneader later defended Elling as 'aberration' - the twist"

  - theme_id: "THEME_03"
    name: "Cover-up Bigger Than Crime"
    attacks_belief: "Justice targets the masterminds"
    emotional_register: "absurdity"
    theme_summary: |
      Martin Elling got 6 months - not for the overdose rebate proposal, not for
      turbocharging OxyContin sales during an epidemic, but for deleting emails
      about it. The system punished the cover-up, not the crime.
    items:
      - item_id: "PB_21"
        role: core
        contribution: "Elling guilty plea - obstruction, not the underlying work"
      - item_id: "PB_22"
        role: core
        contribution: "6 months prison - concrete but light sentence"
      - item_id: "PB_25"
        role: supporting
        contribution: "Only individual prosecution - raises scapegoat question"

orphaned_items:
  - item_id: "PB_CE_03"
    reason: "Counter-evidence about FDA approval - may use in fairness section"
    potential_use: "Balance/fairness moment in writing"
  - item_id: "PB_09"
    reason: "General pharma distrust - background context only"
    potential_use: "Could inform hook/setup, not a theme beat"

synthesis_metadata:
  total_items_input: 45
  items_assigned: 41
  items_orphaned: 4
  theme_count: 5

validation:
  all_items_assigned_once: true
  themes_distinct: true
  minimum_theme_count_met: true
  maximum_theme_count_met: true
  all_themes_have_minimum_items: true
```

---

## COMPLETION RULE

You are done when:
- All items from input are accounted for (assigned to theme OR orphaned)
- Each item appears in exactly one theme
- Theme count is 3-6
- Each theme has at least 2 items
- All validation flags pass
- Output written to `STEP1_themes.yaml`

---

## NEXT STEP

`STEP1_themes.yaml` -> `steps/2_theme_selection.md`

Each theme becomes a candidate section. Selection determines which items within each theme are essential to land the theme.
