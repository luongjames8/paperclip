# 6c: GENERATE SLOTS

## SINGLE CONCERN

Create evidence slots for the Research module.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The surviving belief (validated by 6a) |
| `content_class` | From step 6a |
| `angles[]` | From step 6b |
| `shape_validation` | From step 6a (confirms reversal type) |
| `priority_candidates[]` | Other surviving beliefs from Phase 5 |

---

## SHARPEST-WINS CONSTRAINT

**The final belief output CANNOT be broader, more abstract, or more moralized than the validated belief from 6a.**

### Why this matters

LLMs naturally want to generalize. Without this constraint, the model will:
- Combine multiple discoveries into a "helpful" umbrella summary
- Soften specific claims into defensible generalities
- Replace sharp data with vague moral judgments

**This destroys the "actually" moment.**

### Rules

| Rule | Constraint |
|------|------------|
| **No broadening** | Final belief ≤ specificity of 6a belief |
| **No synthesis** | Do NOT combine multiple beliefs into one |
| **No moral upgrade** | Do NOT convert specific claim → moral verdict |
| **Preserve numbers** | If 6a belief has data, final must have data |

### Validation check

Before outputting final belief, verify:

```
SHARPNESS CHECK:
□ Final belief is NOT broader than 6a input belief
□ Final belief preserves specific numbers/data if present
□ Final belief is NOT a moral summary
□ Final belief could NOT have been written without the discovery
```

### Bad vs Good

| 6a Input | Bad Output (broadened) | Good Output (preserved) |
|----------|------------------------|-------------------------|
| "Gen Z is 3x more likely to be scammed than Boomers" | "Young people are vulnerable to scams" | "Gen Z is 3x more likely to be scammed than Boomers—digital skepticism backfires" |
| "97% post ads, 20% disclose" | "Influencers lack transparency" | "97% of influencers post ads but only 20% disclose—and the skeptics get scammed most" |
| "Snark subreddits replaced the FTC" | "Social media enables accountability" | "Snark subreddits now punish influencer misconduct faster than the FTC" |

---

## OUTPUT

```yaml
# DISCOVERY_RESULT.yaml format

belief: "The expectation of lifetime employment persists in Japanese workplace culture, even though actual job tenure has declined significantly"

content_class: detonator

provisional_outline:
  - slot_id: AP_01
    description: "Current job mobility statistics - how tenure has actually changed"
    derived_from: "expectation vs reality gap angle"
    required: true

  - slot_id: AP_02
    description: "Historical origin - when and why lifetime employment became expected"
    derived_from: "historical context angle"
    required: true

  - slot_id: AP_03
    description: "Generational attitudes - how younger workers view job-hopping"
    derived_from: "generational split angle"
    required: true

  - slot_id: AP_04
    description: "Where it still holds - large traditional companies vs new economy"
    derived_from: "company size variation angle"
    required: true

  - slot_id: AP_05
    description: "Why the expectation persists despite behavioral change"
    derived_from: "expectation vs reality gap angle"
    required: true

  - slot_id: AP_06
    description: "Implications for foreign workers and companies"
    derived_from: "implications for foreigners angle"
    required: false
```

---

## SLOT DESIGN PRINCIPLES

### Slots must be

| Criterion | Description |
|-----------|-------------|
| **Specific** | Clear what evidence would fill it |
| **Angle-derived** | Connected to identified angles |
| **Searchable** | Research module can find evidence |
| **Distinct** | Each slot covers unique ground |
| **Content-class aligned** | Fits detonator or mirror structure |

### Detonator slot pattern

For `content_class: detonator`:

1. **Establish** - Show the belief exists (sincere holders)
2. **Challenge** - Evidence that contradicts
3. **Explain** - Why reality differs from perception
4. **Nuance** - Where belief partially holds
5. **Stakes** - Why this matters

### Mirror slot pattern

For `content_class: mirror`:

1. **Validate** - Confirm the belief is correct
2. **Deepen** - The mechanism/explanation
3. **Extend** - Implications they haven't considered
4. **Contextualize** - Where/when this applies
5. **Actionable** - What to do with this knowledge

---

## SLOT DERIVATION

Every slot must trace back to an angle:

```yaml
slot_derivation:
  - slot_id: AP_01
    derived_from: "expectation vs reality gap angle"
    why: "Need data to show the gap exists"

  - slot_id: AP_02
    derived_from: "historical context angle"
    why: "Origin story explains why expectation exists"
```

Do NOT create slots that don't connect to identified angles.

---

## QUANTITY TARGETS

| content_class | Recommended slots |
|---------------|-------------------|
| detonator | 4-6 slots |
| mirror | 4-6 slots |

**Required vs optional:**
- Mark 3-5 slots as `required: true`
- 1-2 slots can be `required: false` (supporting material)

---

## SLOT QUALITY CHECK

| Good slot | Bad slot |
|-----------|----------|
| "Job mobility statistics since 2000" | "Japanese work culture" (too vague) |
| "Generational attitudes toward job-hopping" | "Young people" (not specific enough) |
| "Where lifetime employment still applies" | "Exceptions" (need to say what kind) |

---

## HARD CONSTRAINTS

- Generate 4-6 slots
- Every slot derived from an angle
- Each slot is specific and searchable
- Slots align with content class structure
- Mark required vs optional
- **Final belief MUST pass sharpness check (not broader than 6a input)**
- **Final belief MUST preserve specific numbers/data**
- **Final belief MUST NOT be a moral verdict or umbrella summary**

---

## COMPLETION RULE

Done when:
- 4-6 slots generated
- Each slot has description and derived_from
- Required/optional marked
- Slots align with content class
- Output matches DISCOVERY_RESULT.yaml format
- **Sharpness check passes (belief not broadened)**

---

## FINAL OUTPUT

This step produces the primary Discovery output:

### DISCOVERY_RESULT.yaml

```yaml
belief: "..."
content_class: detonator | mirror

provisional_outline:
  - slot_id: AP_01
    description: "..."
    required: true
  # ... more slots
```

This file is consumed by the Research module.
