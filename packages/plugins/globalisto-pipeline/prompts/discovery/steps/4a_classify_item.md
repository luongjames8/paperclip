# 4a: CLASSIFY ITEM

## SINGLE CONCERN

Classify a single discourse item as SINCERE, STRAWMAN, or NEUTRAL.

---

## INPUT

| Input | Source |
|-------|--------|
| `item` | A single discourse item |
| `belief_context` | The belief this item relates to |

---

## OUTPUT

```yaml
item_id: D_01
belief_id: B_01  # The belief this item relates to (from belief_context input)
classification: SINCERE | STRAWMAN | NEUTRAL
confidence: HIGH | MEDIUM | LOW
reasoning: |
  [Why this classification was chosen]
key_signals:
  - "First-person statement of belief"
  - "Defending position when challenged"
```

**REQUIRED FIELDS:** `item_id`, `belief_id`, `classification`

---

## CLASSIFICATION DEFINITIONS

### SINCERE

The person genuinely holds or defends this belief.

**Signals:**
- "I think...", "I believe...", "In my experience..."
- Defending the position when challenged
- Personal stake in the belief
- Emotional investment
- Detailed reasoning supporting belief

**Examples:**
> "I've worked here 15 years and honestly, I do feel like I owe the company something. That's just how I was raised."

> "Call me old-fashioned but I think loyalty to your employer still matters."

### STRAWMAN

The person is attacking a caricature of the belief that no one actually holds.

**Signals:**
- "Nobody believes...", "The myth that...", "People still think..."
- Mocking or dismissive tone
- Attacking extreme version
- No engagement with actual believers
- "Lol", "imagine thinking..."

**Examples:**
> "Lol people still think Japanese workers are loyal? That's such a boomer take."

> "The myth of Japanese work ethic needs to die. Nobody actually believes in karoshi as a badge of honor."

### NEUTRAL

Descriptive or analytical, not taking a position.

**Signals:**
- "Some people think...", "There's a debate about..."
- Academic or journalistic framing
- Presenting multiple sides
- Not personally invested
- Reporting rather than arguing

**Examples:**
> "There's a debate about whether traditional employment values still apply in modern Japan."

> "Studies show that attitudes toward job-hopping vary by age group."

---

## EDGE CASES

| Scenario | Classification |
|----------|----------------|
| Person USED to believe, doesn't now | NEUTRAL (they're describing, not holding) |
| Sarcastic defense | Check context - could be STRAWMAN |
| "Devil's advocate" | NEUTRAL (explicitly not their belief) |
| Angry but genuine | SINCERE (emotion doesn't disqualify) |
| Attacking specific person, not belief | NEUTRAL (personal, not about belief) |

---

## CONFIDENCE LEVELS

| Level | When to use |
|-------|-------------|
| HIGH | Clear signals, unambiguous |
| MEDIUM | Some ambiguity but likely correct |
| LOW | Difficult to determine, edge case |

---

## HARD CONSTRAINTS

- Classify ONE item per invocation
- Must provide reasoning
- Must note key signals observed
- Focus on whether person HOLDS the belief, not whether belief is TRUE
- Do not aggregate or score (that's step 4b)

---

## COMPLETION RULE

Done when:
- Classification assigned
- Confidence level set
- Reasoning explains why
- Key signals listed

---

## NEXT STEP

After all items classified → `steps/4b_score_bonafide.md`
