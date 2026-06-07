# STEP 1: CONTENT CLASSIFICATION

## PURPOSE

Classify all material into structural roles BEFORE selection.

This step answers: "Is this material necessary for belief collapse, or is it enrichment that could weaken structure?"

---

## INPUT

| Input | Source |
|-------|--------|
| `potential_material` | Raw research, facts, quotes from upstream |
| `belief` | The belief to collapse or destabilize |
| `ANGLE_LOCK.yaml` | Firm angle lock from post-research validation |

---

## OUTPUT

### `classified_material.yaml`

```yaml
classified_material:
  spine_material: []      # Required for belief collapse
  structural_support: []  # Explains/stabilizes existing spine
  nsem_atomic: []         # Single facts, 1-2 sentences max
  nsem_thematic: []       # Could sustain dedicated section
  contextual_flavor: []   # Texture only, fully removable

  classification_summary:
    total_items: [N]
    spine: [N]
    structural_support: [N]
    nsem_atomic: [N]
    nsem_thematic: [N]
    contextual_flavor_cut: [N]
```

---

## CONTENT ROLES (EXACTLY ONE PER ITEM)

| Role | Code | Meaning | Treatment |
|------|------|---------|-----------|
| **Spine Material** | SM | Required for belief collapse | Goes to selection step |
| **Structural Support** | SS | Explains/stabilizes spine material | Lives inside a unit, not standalone |
| **Non-Spine Enrichment (Atomic)** | NSEM-A | Single fact, anecdote, quote | Brief texture only (1-2 sentences), NO dedicated section |
| **Non-Spine Enrichment (Thematic)** | NSEM-T | Combines multiple elements into theme | May get dedicated section post-resolution |
| **Contextual Flavor** | CF | Texture only, no structural impact | Fully removable — CUT IT |

---

## CLASSIFICATION TEST (MANDATORY)

For EACH item in `potential_material`, answer in order:

### Question 1: Does removing this break belief collapse?
- YES → **SPINE MATERIAL (SM)**
- NO → Continue to Question 2

### Question 2: Does this stabilize or explain existing spine material?
- YES → **STRUCTURAL SUPPORT (SS)**
- NO → Continue to Question 3

### Question 3: Does this increase meaning AFTER belief collapse?
- YES → Continue to NSEM Scale Test
- NO → **CONTEXTUAL FLAVOR (CF)** — cut it

### NSEM Scale Test (for items that passed Q3)

| Question | Answer |
|----------|--------|
| Is this a single fact/quote/anecdote? | → NSEM-A |
| Does this combine multiple related elements into a theme? | → NSEM-T |
| Could this sustain 60+ seconds of content without repetition? | → NSEM-T |
| Would expanding this require inventing connective material? | → NSEM-A |

---

## ANTI-REVERSAL RULE (MANDATORY)

Non-Spine Enrichment (NSEM-A or NSEM-T) MUST NOT:
- Re-argue the collapsed belief
- Introduce alternative interpretations of the belief
- Re-open belief legitimacy emotionally or logically

**NSEM may deepen context, not re-litigate the spine.**

Violation → classification invalid.

---

## PROCESS

### Step 1: Inventory All Material

List everything in `potential_material`:
- Facts
- Quotes
- Anecdotes
- Data points
- Concepts
- Any "feels too important to drop" items

### Step 2: Apply Classification Test

For EACH item:
1. Answer Q1-Q3 in order
2. If NSEM, apply scale test
3. Assign exactly ONE role

### Step 3: Document Rationale

For each classification:
```yaml
- item_id: "[ID]"
  description: "[what it is]"
  role: SM | SS | NSEM-A | NSEM-T | CF
  rationale: "[why this role]"
  scale_rationale: "[NSEM only - why A vs T]"
```

### Step 4: Flag Contextual Flavor

Items classified as CF should be explicitly flagged as CUT.
Do not carry them forward.

---

## ANGLE ALIGNMENT

- Content classification MUST align with the locked angle type
- If angle_type is "expose", classification should treat investigative/analytical material as spine-eligible
- If angle_type is "story", classification should treat narrative/documentary material as spine-eligible
- The locked angle constrains classification — do NOT classify in a way that contradicts the angle
- Material that directly supports the locked title's promise is spine-eligible; material that contradicts it is CF

---

## HARD CONSTRAINTS

- Every item gets exactly ONE role
- Classification happens BEFORE selection
- Spine Material is not negotiable — if belief collapse needs it, it's SM
- NSEM-A items may NEVER get dedicated sections
- CF items are CUT — do not include in output

---

## COMPLETION RULE

You are done when:
- All items in `potential_material` are classified
- Each item has exactly one role
- NSEM items have A/T scale classification
- Rationale documented for each
- CF items explicitly marked as cut
- Anti-reversal rule verified for all NSEM

---

## NEXT STEP

`classified_material` → `steps/unit_selection.md`

Only SM and SS items proceed to selection. NSEM items are held for enrichment routing after graph is built.
