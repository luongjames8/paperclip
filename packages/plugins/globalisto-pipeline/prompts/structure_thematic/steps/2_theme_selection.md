# STEP 2: THEME SELECTION

## PURPOSE

Select the minimum items within each theme required to LAND that theme.

This step answers: "What's the smallest set of items that makes this theme hit?"

---

## INPUT

| Input | Source |
|-------|--------|
| `STEP1_themes.yaml` | From Step 1 (thematic_synthesis) |

### Input Schema

```yaml
themes:
  - theme_id: "THEME_01"
    name: "Punished for Apologizing"
    attacks_belief: "Getting fired means disgrace"
    emotional_register: "irony"
    items:
      - item_id: "PB_32"
        role: "core"
      - item_id: "PB_33"
        role: "core"
      - item_id: "PB_36"
        role: "supporting"

orphaned_items:
  - item_id: "PB_XX"
    reason: "Background context, no thematic home"
```

---

## OUTPUT

### `STEP2_selected_themes.yaml`

```yaml
selected_themes:
  - theme_id: "THEME_01"
    name: "Punished for Apologizing"
    attacks_belief: "Getting fired means disgrace"
    emotional_register: "irony"
    selected_items:
      - item_id: "PB_32"
        original_role: core
        reason: "Establishes the firing - core setup"
      - item_id: "PB_36"
        original_role: supporting
        reason: "The twist - defends the convict. Theme lands here."
    discarded_items:
      - item_id: "PB_33"
        reason: "Redundant with PB_32 - same evidence, less specific"

  - theme_id: "THEME_02"
    name: "Horror is Banal"
    attacks_belief: "This was aberrant behavior"
    emotional_register: "cold precision"
    selected_items:
      - item_id: "PB_07"
        original_role: core
        reason: "$14,810 figure - the precision IS the horror"
      - item_id: "PB_12"
        original_role: supporting
        reason: "Excel calculations - mundane tools for death"
    discarded_items:
      - item_id: "PB_15"
        reason: "Same emotional register as PB_12, adds volume not impact"

selection_summary:
  themes_in: 5
  themes_out: 4
  items_selected: 11
  items_discarded: 34
  discard_rate: 0.76

discarded_themes:
  - theme_id: "THEME_05"
    name: "Idea vs Action"
    reason: "Overlaps with Settlement Paradox - both about legal abstraction"
    items_redistributed_to: "THEME_03"

enrichment_pool:
  - item_id: "PB_XX"
    original_theme: "THEME_XX"
    discard_context: "theme_killed | item_limit | not_essential"
    audience_value: "concrete_number | dramatic_event | jargon_explainer | human_detail | vivid_quote"
    one_liner: "35% vs 80% yields — makes TSMC dominance tangible"
```

---

## THE SELECTION TEST (CRITICAL)

### Current Pipeline Test (DO NOT USE)
"Does removing this break belief collapse?"

### New Thematic Test (USE THIS)
"Does removing this break the THEME?"

This is the key insight. Items exist to land THEMES, not to prove arguments.

---

## SELECTION CRITERIA (ALL MUST PASS)

### 1. Essential to Theme Landing

Test: "If I remove this item, does the theme still land?"
- YES, theme still lands -> discard (redundant)
- NO, theme weakens or fails -> keep (essential)

"Landing" means the viewer gets it. The theme registers. Not just that it's mentioned.

### 2. Distinct Within Theme

Test: "Does another selected item already do what this one does?"
- YES -> keep the stronger one, discard this
- NO -> keep

Within a theme, each item must serve a unique function:
- One sets up the theme
- One escalates it
- One lands it (the "wait, what?" moment)

### 3. Maximum Impact Density

If two items land the same aspect of the theme:
- Keep the one with: specific number, specific name, specific moment
- Discard the one with: general claim, category, abstraction

Specificity wins.

**EXCEPTION**: See "Special Case: Model-Scope Beliefs" below before discarding comparative evidence.

---

## SPECIAL CASE: Model-Scope Beliefs

Before applying "specificity wins" to discard comparative evidence, check the belief scope.

### Is This Belief About a MODEL/CATEGORY/SYSTEM?

Examples of model-scope beliefs:
- "Chaebols are effective organizational models" (MODEL, not one company)
- "Hierarchical structures are superior for innovation" (CATEGORY, not one org)
- "Open offices improve productivity" (SYSTEM, not one office)

Company-scope beliefs (these do NOT require control groups):
- "Samsung Electronics will maintain chip leadership" (one company)
- "This CEO is effective" (one person)

### Control Group Test (for model-scope beliefs only)

**Test**: "If I remove the comparative evidence, can the audience dismiss this as instance-specific rather than model-specific?"

Examples:
- "Maybe Samsung is uniquely bad" (dismisses as company-specific)
- "Maybe this person just had bad luck" (dismisses as individual case)
- "Maybe this one office had other problems" (dismisses as local issue)

If YES → the comparative evidence is LOAD-BEARING. Keep it.

### Why This Matters

Without a control group, anecdotal evidence proves the INSTANCE failed, not the MODEL.

**Example**:
- Belief: "Chaebols are effective" (MODEL-SCOPE)
- Anecdotal only: "Samsung engineer succeeded after leaving Samsung"
  → Audience: "Maybe Samsung is uniquely bad, not chaebols generally"
- Anecdotal + Control: "Same engineer succeeded at SK Hynix (also Korean, different model)"
  → Proves: It's the CHAEBOL MODEL, not Samsung specifically

The control group eliminates confounding variables and proves MODEL failure.

### Selection Rules for Model-Scope Beliefs

1. Keep at least ONE comparative/control-group item per theme if available
2. The comparison must share context (same country/industry/time) to eliminate confounding variables
3. Even if comparative item seems "abstract" vs anecdotal, preserve it if it provides the control group
4. Both anecdotal AND comparative can coexist in the 3-item limit when belief is model-scoped

---

## ITEM LIMITS

| Level | Minimum | Maximum |
|-------|---------|---------|
| Per theme | 1 | 3 |
| Total selected | 6 | 12 |
| Themes retained | 3 | 5 |

### Why These Limits

**Per theme max 3:** A theme that needs more than 3 items isn't tight. Consider splitting into two themes or cutting the weakest items.

**Total 6-12:** This is content for narrative structure (retention arcs). Too few = no story. Too many = bloated.

**Themes 3-5:** Fewer than 3 = not a full narrative. More than 5 = unfocused.

---

## THEME EVALUATION

Before selecting items within a theme, evaluate if the theme itself survives.

### Theme Survival Test

For each theme, ask:
1. Is this theme DISTINCT from every other theme?
2. Does this theme attack a different belief OR use a different angle?
3. Does this theme have at least ONE item that could land it?

If NO to any -> consider merging or discarding the theme.

### Theme Merge Rules

Merge themes when:
- They attack the same belief from the same angle
- Their items would be interchangeable
- Removing one wouldn't reduce narrative coverage

When merging:
- Keep the stronger theme name
- Redistribute items
- Document in `discarded_themes`

---

## PROCESS

### Step 1: Evaluate Theme Survival

For each theme:
1. Apply theme survival test
2. Mark themes to merge or discard
3. Redistribute orphaned items if possible

### Step 2: Select Within Each Surviving Theme

For each surviving theme:
1. List all items assigned to this theme
2. For each item, apply the selection test:
   - "If I remove this, does the theme still land?"
3. Keep only items where answer is NO
4. If more than 3 remain, force-rank and cut to 3

### Step 3: Verify Distinct Functions

Within each theme's selected items:
1. Label each item's function: setup | escalate | land
2. If two items have same function -> keep stronger, discard weaker
3. Ideal: one item per function (max 3)

### Step 4: Check Total Counts

Sum across all themes:
- If < 6 total selected: themes are too thin. Revisit step 1 output.
- If > 12 total selected: tighten selection. Apply "essential to theme landing" test more strictly.

### Step 5: Document Everything

For each selected item:
```yaml
- item_id: "[ID]"
  original_role: core | supporting
  reason: "[why essential to this theme]"
```

For each discarded item:
```yaml
- item_id: "[ID]"
  reason: redundant | weaker_than:[ID] | not_essential | theme_merged
```

### Step 6: Build Enrichment Pool

After all selection and discard decisions are final, scan discarded items for writing texture value.

**Eligible items** — discarded for STRUCTURAL reasons only:
- `not_essential` — didn't land the theme, but has audience value
- `theme_killed` / `theme_merged` — lost when entire theme was killed or merged
- `item_limit` — cut to stay within per-theme or total caps

**NOT eligible** — discarded for QUALITY reasons:
- `redundant` — another item already does this
- `weaker_than:[ID]` — strictly inferior to a kept item

**Audience value patterns** (item must match at least one):
- **Concrete numerical comparisons** — makes abstract claims tangible (e.g., "35% vs 80% yields")
- **Dramatic first-time or record-breaking events** — creates "wait, what?" moments
- **Jargon explanations** — makes technical content accessible to mass audience
- **Relatable human-scale details** — salary gaps, work conditions, personal stories
- **Vivid quotes from named sources** — adds credibility texture

If a discarded item matches an eligible reason AND at least one audience value pattern, add it to `enrichment_pool`. This is NOT a backdoor to keep everything — most discards will have neither eligible reason nor audience value. Expect 0-5 items in a typical pool.

---

## HARD CONSTRAINTS

- Selection test is "breaks the THEME" not "breaks the belief"
- Maximum 3 items per theme
- Total selected items: 6-12
- Retained themes: 3-5
- Each selected item must be distinct within its theme
- If theme has > 3 essential items, it's two themes - split it
- Document all discards with reasons

---

## ANTI-PATTERNS (AVOID)

### "But it's such good material"

The best material that doesn't land a theme is still a discard. This is selection by function, not quality.

### "We might need it later" (for structure)

If an item doesn't land a theme, it won't become structurally essential later. Cut it from the theme. But if it has mass-audience texture value (concrete numbers, dramatic events, jargon explanations), flag it for the enrichment pool so the writer can use it as color. Structural cuts are still strict — the enrichment pool is a writing resource, not a structural backdoor.

### "Keep both, they're different"

If you can't articulate HOW they're different in theme function (setup vs escalate vs land), they're probably redundant. Keep one.

### "This theme needs all 5 items"

No theme needs 5 items. You either have redundancy or you have two themes masquerading as one. Split or cut.

---

## EXAMPLE: McKinsey Opioid

### Input Theme

```yaml
- theme_id: "THEME_01"
  name: "Punished for Apologizing"
  attacks_belief: "Getting fired means disgrace"
  emotional_register: "irony"
  items:
    - item_id: "PB_32"  # Sneader fired for apologizing
      role: "core"
    - item_id: "PB_33"  # Apologized at Davos
      role: "core"
    - item_id: "PB_34"  # Partners voted him out
      role: "supporting"
    - item_id: "PB_36"  # Later defended Elling
      role: "supporting"
```

### Selection Process

1. **PB_32** (fired for apologizing): Essential. This IS the theme. Keep.
2. **PB_33** (apologized at Davos): Redundant with PB_32. The firing implies the apology. Discard.
3. **PB_34** (partners voted him out): Adds detail to PB_32 but not distinct pressure. Discard.
4. **PB_36** (defended convict later): THE TWIST. Without this, theme is "guy got fired." With this, theme is "punished for remorse, then proven remorseless." Keep.

### Output

```yaml
- theme_id: "THEME_01"
  name: "Punished for Apologizing"
  selected_items:
    - item_id: "PB_32"
      reason: "Establishes the core irony - fired for showing remorse"
    - item_id: "PB_36"
      reason: "The twist that lands the theme - the 'apology' was performance"
  discarded_items:
    - item_id: "PB_33"
      reason: "Redundant - PB_32 already establishes the apology"
    - item_id: "PB_34"
      reason: "Detail, not distinct - voting mechanism doesn't change the theme"
```

2 items selected. Theme lands with setup (PB_32) and twist (PB_36).

---

## COMPLETION RULE

You are done when:
- All themes evaluated for survival (merge/discard decisions made)
- Each surviving theme has 1-3 selected items
- Total selected items: 6-12
- Total retained themes: 3-5
- Each selected item has documented reason
- Each discarded item has documented reason
- No item appears in multiple themes
- Discarded themes documented with reason and item redistribution
- Enrichment pool populated (scan all structural discards for audience value)

---

## NEXT STEP

`STEP2_selected_themes.yaml` -> `steps/3_narrative_gap_analysis.md`

Selected themes proceed to gap analysis to identify missing narrative elements (GROUND, IMPLICATE, LAND).
