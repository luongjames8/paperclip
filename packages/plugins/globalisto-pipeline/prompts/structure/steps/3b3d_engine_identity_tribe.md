# Step 3B-3d: Identity/Tribe Engine

**Version:** 1.0
**Last Updated:** 2026-01-22

## Purpose
Design audience positioning and tribal engagement signals.

## Data Contract

### Input Schema
```yaml
validated_input:
  beats: array
  beat_count: int
pipeline_context: object
```

### Output Schema
```yaml
identity_tribe:
  target_identity: string
  positioning_statement: string
  in_group_signals: array
  out_group_contrast: array
  validation_moments: array
```

## Logic

### 1. Identify Target Identity

Who is this content for? Define the tribe.

**Patterns:**
- "People who believe [X]"
- "People who have experienced [Y]"
- "People who value [Z]"
- "People frustrated by [W]"

**Detection:**
- Look for "you" statements that assume shared experience
- Find implied shared values or frustrations
- Identify common enemy or obstacle

### 2. Craft Positioning Statement

One sentence that makes target audience feel "this is for me."

**Formula:** "[Audience] who [shared experience/belief], this is [what you'll get]"

**Example:** "If you've ever been told your ideas are 'too ambitious,' this is for you."

### 3. Map In-Group Signals

Moments that make the tribe feel recognized.

**Types:**
- Shared experience reference
- Inside joke or terminology
- Value affirmation
- "You're not alone" moments

### 4. Map Out-Group Contrast

Moments that define who the content is NOT for.

**Caution:** Should be about ideas/behaviors, not people
**Purpose:** Strengthens in-group identity without being divisive

### 5. Identify Validation Moments

Points where the audience's worldview is confirmed.

**Purpose:** Creates "finally someone gets it" feeling
**Placement:** Ideally every 2-3 minutes

## Output

```yaml
identity_tribe:
  target_identity: "[description of target audience]"
  positioning_statement: "[one sentence hook for tribe]"

  in_group_signals:
    - beat: "BEAT_01"
      signal: "[shared experience or belief referenced]"
      type: "shared_experience" | "value_affirmation" | "terminology"
    - beat: "BEAT_03"
      signal: "[another signal]"
      type: "..."

  out_group_contrast:
    - beat: "BEAT_02"
      contrast: "[what the content pushes back against]"
      target: "idea" | "behavior" | "conventional_wisdom"

  validation_moments:
    - beat: "BEAT_04"
      validation: "[how audience worldview is confirmed]"
    - beat: "BEAT_07"
      validation: "[another confirmation]"

  validation:
    identity_clear: true
    in_group_signals_count: 3
    validation_spacing_ok: true  # at least one every 3 beats
```

## Error Handling

### On No Clear Identity
- Log: `{error: "NO_IDENTITY", message: "Cannot determine target audience"}`
- Action: Return error to router for fallback

### On No In-Group Signals
- Log: `{warning: "WEAK_TRIBAL_SIGNAL", message: "Few in-group moments"}`
- Action: Return with suggestions for adding signals

## Contract Test

**Input:**
```yaml
beats:
  - id: "BEAT_01"
    content: "If you've ever been told you're 'overcomplicating things' when you raise concerns..."
  - id: "BEAT_02"
    content: "While everyone else celebrates the 'move fast and break things' culture..."
  # ... more beats
```

**Expected Output:**
```yaml
identity_tribe:
  target_identity: "Thoughtful professionals frustrated by move-fast culture"
  positioning_statement: "For those who've been told they think too much—you were right to be cautious."

  in_group_signals:
    - beat: "BEAT_01"
      signal: "Being told you're overcomplicating things"
      type: "shared_experience"

  out_group_contrast:
    - beat: "BEAT_02"
      contrast: "Move fast and break things mentality"
      target: "behavior"

  validation_moments:
    - beat: "BEAT_05"
      validation: "Data shows cautious approaches outperform"
```

## Return to Router
Return `identity_tribe` object to 3B-3 router for assembly.
