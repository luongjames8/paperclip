# 6b: IDENTIFY ANGLES

## SINGLE CONCERN

Identify what aspects of this belief people argue about or care about.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The surviving belief |
| `content_class` | From step 6a |
| `discourse_items[]` | From bottom-up extraction |
| `invalidators[]` | From step 5b |

---

## OUTPUT

```yaml
belief: "The expectation of lifetime employment persists in Japanese workplace culture, even though actual job tenure has declined significantly"

angles:
  - angle: "Generational split"
    description: "How attitudes differ between older and younger workers"
    discourse_refs: [D_02, D_07, D_11]
    debate_pattern: "Old guard values loyalty, young workers job-hop"
    content_potential: HIGH

  - angle: "Expectation vs reality gap"
    description: "Cultural expectation persists despite behavioral change"
    discourse_refs: [D_01, D_05]
    invalidator_refs: [INV_01, INV_04]
    debate_pattern: "What people think should happen vs what does happen"
    content_potential: HIGH

  - angle: "Company size variation"
    description: "Large traditional firms vs startups/foreign companies"
    discourse_refs: [D_08]
    invalidator_refs: [INV_03]
    debate_pattern: "Different rules for different contexts"
    content_potential: MEDIUM

  - angle: "Historical context"
    description: "Where this expectation came from, how it evolved"
    discourse_refs: []
    invalidator_refs: [INV_02]
    debate_pattern: "Was it ever really universal?"
    content_potential: MEDIUM

  - angle: "Implications for foreigners"
    description: "How this affects non-Japanese workers in Japan"
    discourse_refs: [D_05, D_08]
    debate_pattern: "Different expectations/experience for outsiders"
    content_potential: MEDIUM

angle_summary: |
  Primary angles: Generational split, expectation/reality gap
  Supporting angles: Company size, historical context, foreigner experience
```

---

## PROCESS

### Find angles in discourse

Scan discourse items for:

| Look for | Angle emerges from |
|----------|-------------------|
| What people argue about | Debate patterns |
| What aspects get heated | Emotional investment |
| What questions people ask | Knowledge gaps |
| What corrections people make | "Actually..." patterns |
| What groups disagree | Demographic/contextual splits |

### Find angles in invalidators

Invalidators often reveal angles:

| Invalidator type | Angle potential |
|------------------|-----------------|
| DATA | Statistical reality angle |
| NUANCE | Contextual variation angle |
| TREND | Historical/change angle |
| EXPERT | Authoritative perspective angle |

### Rate content potential

| Rating | Criteria |
|--------|----------|
| HIGH | Multiple discourse items, clear debate, emotional resonance |
| MEDIUM | Some discourse, relevant to belief, less heated |
| LOW | Tangential, little discourse support |

---

## ANGLE QUALITY CRITERIA

### Good angles

| Quality | Description |
|---------|-------------|
| Grounded | Connected to actual discourse found |
| Debated | People have different positions |
| Relevant | Central to the belief, not tangential |
| Researchable | Can find evidence to address this |

### Avoid

| Problem | Example |
|---------|---------|
| Invented | No discourse supports this angle |
| Too broad | "Japanese culture" (not specific enough) |
| Too narrow | One person's opinion |
| Off-topic | Tangentially related but not core |

---

## HARD CONSTRAINTS

- Angles must connect to discourse or invalidator evidence
- Include discourse refs and/or invalidator refs
- Rate content potential honestly
- Do not generate slots (that's step 6c)
- Aim for 3-6 angles

---

## COMPLETION RULE

Done when:
- 3-6 angles identified
- Each linked to evidence (discourse or invalidators)
- Content potential rated
- Summary identifies primary vs supporting angles

---

## NEXT STEP

`angles[]` → `steps/6c_generate_slots.md`
