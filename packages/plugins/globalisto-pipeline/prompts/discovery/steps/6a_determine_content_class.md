# 6a: DETERMINE CONTENT CLASS

## SINGLE CONCERN

Validate belief shape, test for reversal, then classify as DETONATOR or MIRROR.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The surviving belief (possibly refined) |
| `survival_verdict` | From step 5c |
| `invalidators[]` | From step 5b (context for classification) |
| `topic_framing` | Original topic description (to detect restatement) |
| `priority_candidates[]` | Other surviving beliefs from Phase 5 (for reformulation) |

---

## BELIEF SHAPE GATE

**Before classifying, validate belief shape. Invalid shapes cannot proceed.**

### Banned belief forms (auto-reject)

| Form | Example | Why invalid |
|------|---------|-------------|
| Moral verdict | "X is deceptive/dangerous/bad" | Audience already agrees morally |
| Analogy/metaphor | "X is modern-day snake oil" | Vibe, not falsifiable claim |
| Category condemnation | "X is broken/unregulated" | Industry-level judgment |
| Topic restatement | Belief ≈ topic framing | Just echoes the premise |

**Test:** Can the audience agree with this in <2 seconds?
- YES → **INVALID** (confirmation, not discovery)
- NO → proceed to reversal test

### Required belief forms (at least one)

| Form | Pattern | Example |
|------|---------|---------|
| Role reversal | "The group assumed X is actually Y" | "Digital natives are the easiest to scam" |
| Mechanism surprise | "X happens because of Y, not Z" | "Disclosure makes scams more effective" |
| Responsibility inversion | "The protector doesn't protect" | "Snark subreddits replaced the FTC" |
| Magnitude inversion | "X is opposite of expected" | "Gen Z tips less than Boomers" |

### If belief fails shape gate

Do NOT proceed with invalid belief. Instead:

1. Check `priority_candidates[]` for a belief with valid shape
2. Reformulate using the strongest surviving discovery
3. Preserve specific numbers/data from the original discovery

---

## BELIEF REVERSAL TEST

**The belief must reverse an assumption, not confirm it.**

### Test question

> "If the audience reads this belief, will they conclude their prior stance was WRONG—or merely JUSTIFIED?"

| Audience reaction | Verdict |
|-------------------|---------|
| "Yeah, I knew that" | **INVALID** - confirmation |
| "That tracks" | **INVALID** - confirmation |
| "Wait, really?" | **VALID** - reversal |
| "I was wrong about this" | **VALID** - reversal |

### Reversal types

| Type | What flips | Example |
|------|-----------|---------|
| Direction reversal | Who/what is at fault | "The victims enable it, not the perpetrators" |
| Magnitude reversal | More/less than expected | "3x worse than assumed" only if audience assumed opposite |
| Mechanism reversal | How it works | "The solution causes the problem" |
| Beneficiary reversal | Who gains/loses | "The protected group is harmed most" |

### CRITICAL: Magnitude alone is not reversal

❌ "Influencers are deceptive" + "97% post ads" = **still confirmation**
(Audience already believed "deceptive" — numbers just intensify)

✅ "The people who trust influencers least get scammed most" = **reversal**
(Audience assumed skepticism protects — it doesn't)

---

## OUTPUT

```yaml
belief: "The expectation of lifetime employment persists in Japanese workplace culture, even though actual job tenure has declined significantly"

# VALIDATION (must pass before classification)
shape_validation:
  passes_shape_gate: true
  belief_form: mechanism_surprise  # role_reversal | mechanism_surprise | responsibility_inversion | magnitude_inversion
  banned_form_check: "Not a moral verdict, analogy, or topic restatement"

reversal_validation:
  passes_reversal_test: true
  audience_prior: "Japanese workers stay forever (simple lifetime employment belief)"
  reversal_type: direction_reversal  # direction | magnitude | mechanism | beneficiary
  audience_reaction: "Wait, the expectation persists even though the practice died?"

# CLASSIFICATION (only after validation passes)
content_class: detonator | mirror

classification_reason: |
  DETONATOR: The audience likely believes the simple version
  ("Japanese workers stay forever"). Content will CHALLENGE this
  with evidence showing declining tenure and generational shift.

  The gap between expectation (cultural) and reality (statistics)
  is the detonation point.

truth_status: |
  Simple belief: FALSE (tenure has declined significantly)
  Refined belief: TRUE (expectation persists despite reality)
  → Content challenges simple belief with nuanced truth
```

---

## CONTENT CLASS DEFINITIONS

### DETONATOR

The belief is **FALSE** (or oversimplified) and content will **CHALLENGE** it.

**Pattern:**
- Audience holds incorrect belief
- Evidence exists to disprove/complicate it
- Content delivers the "actually..." moment
- Satisfaction comes from having wrong belief corrected

**Signals:**
- Invalidators showed belief is false/incomplete
- Gap between common perception and reality
- "What everyone gets wrong about X"

### MIRROR

The belief is **TRUE** and audience **UNDERESTIMATES** it. Content will **DEEPEN** understanding.

**Pattern:**
- Audience vaguely suspects something is true
- Reality is **more extreme** than they imagine
- Content reveals the surprising magnitude/mechanism
- Satisfaction comes from "holy shit, it's even more than I thought"

**Signals:**
- Belief survived invalidation well
- Truth is more interesting than surface level
- Audience would be SURPRISED by the degree/mechanism

**MIRROR restrictions (critical):**

| Scenario | Valid MIRROR? |
|----------|---------------|
| Audience thinks X is bad, data shows X is bad | ❌ NO - just confirmation |
| Audience thinks X is bad, data shows X is 10x worse via unexpected mechanism | ✅ YES - magnitude + mechanism surprise |
| Audience vaguely suspects X, data shows X with shocking specificity | ✅ YES - vague → concrete is valuable |
| Audience morally condemns X, data supports condemnation | ❌ NO - moral alignment without surprise |

**MIRROR is NOT:**
- "You were right to be upset about X"
- "X is indeed as bad as you thought"
- "Here's more evidence for your existing view"

**MIRROR IS:**
- "You suspected X, but the mechanism is wilder than you imagined"
- "You thought X was 2, it's actually 20"
- "You knew X existed, but not HOW it works"

---

## CLASSIFICATION LOGIC

### Detonator signals

| Signal | Interpretation |
|--------|----------------|
| Belief WOUNDED in invalidation | Simple form was wrong |
| Strong invalidators exist | Audience belief can be challenged |
| Gap between perception and data | Content exposes the gap |
| "Everyone thinks X but actually Y" | Classic detonator setup |

### Mirror signals

| Signal | Interpretation |
|--------|----------------|
| Belief SURVIVES invalidation | Core belief is correct |
| Weak/no invalidators | Belief stands up to scrutiny |
| Depth beyond surface | More to understand |
| "You're right about X, here's why" | Classic mirror setup |

### Decision matrix

| Survival Verdict | Invalidators | Likely Class |
|------------------|--------------|--------------|
| KILLED | Strong | N/A (don't proceed) |
| WOUNDED | Strong | DETONATOR |
| SURVIVES | Moderate | Could be either |
| SURVIVES | Weak/None | MIRROR |

---

## EXAMPLES

### Detonator
```yaml
belief: "Japanese workers stay at one company forever"
reality: "Tenure has declined significantly"
content_class: detonator
reason: "Audience belief is wrong. Content challenges with data."
```

### Mirror
```yaml
belief: "Japanese convenience stores are remarkably efficient"
reality: "They really are, and here's the system behind it"
content_class: mirror
reason: "Audience intuition is correct. Content deepens understanding."
```

### WOUNDED → Detonator
```yaml
original_belief: "AI will replace all jobs"
refined_belief: "AI will transform work but won't eliminate jobs entirely"
content_class: detonator
reason: "Content challenges apocalyptic belief with nuanced reality."
```

### FAILS shape gate (invalid belief)
```yaml
belief: "Influencers are modern-day snake oil salesmen: 97% post commercial content but only 20% disclose it"

shape_validation:
  passes_shape_gate: false
  failure_reason: "Moral verdict ('snake oil salesmen') + topic restatement"
  banned_form_detected: "analogy/metaphor + moral verdict"

reversal_validation:
  passes_reversal_test: false
  audience_prior: "Influencers are shady/deceptive"
  failure_reason: "Belief CONFIRMS audience prior, doesn't reverse it"
  audience_reaction: "Yeah, I knew that"

reformulation_needed: true
suggested_alternatives:
  - "Gen Z is 3x more likely to be scammed by influencers than Boomers—digital skepticism makes them easier targets"
  - "Snark subreddits now punish influencer misconduct faster than the FTC"
  - "The people most confident they can spot influencer deception are the most likely to fall for it"
```

### PASSES all gates (valid belief)
```yaml
belief: "Gen Z is 3x more likely to be scammed by influencers than Boomers—digital skepticism backfires"

shape_validation:
  passes_shape_gate: true
  belief_form: role_reversal
  banned_form_check: "Not a moral verdict, specific falsifiable claim"

reversal_validation:
  passes_reversal_test: true
  audience_prior: "Digital natives are savvy; Boomers are the vulnerable ones"
  reversal_type: beneficiary_reversal
  audience_reaction: "Wait, Gen Z is MORE vulnerable? I assumed the opposite"

content_class: detonator
classification_reason: "Audience assumes digital natives are protected by skepticism. Data shows the opposite—their overconfidence makes them easier targets."
```

---

## HARD CONSTRAINTS

- **Belief must pass shape gate BEFORE classification**
- **Belief must pass reversal test BEFORE classification**
- If belief fails either gate → reformulate from `priority_candidates[]`
- Must choose ONE class (detonator OR mirror)
- MIRROR only valid if audience underestimates (not just agrees)
- Classification must align with truth status
- Document reasoning clearly
- Connect to invalidation results
- **NEVER output a moral verdict as belief** ("X is bad/deceptive/dangerous")
- **NEVER output topic restatement as belief**

---

## COMPLETION RULE

Done when:
- Shape validation documented (passes_shape_gate, belief_form)
- Reversal validation documented (passes_reversal_test, audience_prior, reversal_type)
- Content class assigned
- Classification reason documented
- Truth status explained
- Connection to invalidation clear

**If validation fails:** Output must include `reformulation_needed: true` and suggest alternative belief from `priority_candidates[]`

---

## NEXT STEP

`content_class` → `steps/6b_identify_angles.md`
