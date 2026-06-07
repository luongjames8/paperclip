# Step 3B-4: Enhancements

**Version:** 1.0
**Last Updated:** 2026-01-22

## Purpose
Add pattern interrupts and end behavior rules.

## Data Contract

### Input Schema
```yaml
forward_pull:
  engine_used: string
  # Plus engine-specific output (loops, emotional_arc, value_density, or identity_tribe)
validated_input:
  beats: array
  beat_count: int
  content_class: string
pipeline_context: object
```

### Output Schema
```yaml
enhancements:
  # tease_points removed - now generated in retention_structure step
  pattern_interrupts: array
  end_behavior: object
  validation:
    interrupts_covered: bool
    end_strategy_valid: bool
```

## Logic

### 1. Pattern Interrupt Zones

**Definition:** Deliberate change in pacing/format to re-engage attention.

**High-risk zones:**
| Zone | Location | Risk | Why |
|------|----------|------|-----|
| post_hook | beat 2-3 | HIGH | Viewer deciding to commit |
| mid_video | 40-60% mark | MEDIUM | Attention fatigue |
| pre_climax | beat before resolution | MEDIUM | "I get it" early exit |

**Detection algorithm:**
```
FOR each zone:
  zone_beat = calculate_beat_for_zone(zone, beat_count)

  # Check if natural interrupt exists
  natural_interrupt = check_for_format_change(zone_beat) OR
                      check_for_new_evidence(zone_beat) OR
                      check_for_tonal_shift(zone_beat)

  IF NOT natural_interrupt:
    prescribe_interrupt(zone_beat)
```

**Interrupt types:**
- `pacing_shift`: Speed up or slow down delivery
- `format_shift`: Change from narration to example, list, etc.
- `tone_shift`: Humor, gravitas, surprise
- `visual_shift`: New location, graphic, demonstration

### 2. End Behavior

**Strategy by content class:**

| Content Class | End Strategy | Main Loop | Forbidden Phrases |
|---------------|--------------|-----------|-------------------|
| investigation | `detonator` | Closes dramatically | "in conclusion", "to summarize", "thanks for watching" |
| explainer | `detonator` | Closes with answer | "in conclusion", "to summarize" |
| essay | `detonator` | Closes with thesis confirmation | "thanks for watching" |
| commentary | `mirror` | Stays open | "the answer is", "you should" |
| opinion | `mirror` | Stays open | "the answer is", "you should" |
| tutorial | `soft_landing` | Clear resolution | (none - recap allowed) |
| guide | `soft_landing` | Clear resolution | (none) |
| analysis | `soft_landing` | Clear resolution | (none) |
| profile | `detonator` | Closes with resolution | "in conclusion" |
| documentary | `detonator` | Closes with resolution | "in conclusion" |
| story | `detonator` | Closes with resolution | "in conclusion" |
| listicle | `soft_landing` | Clear completion | "in conclusion" |
| review | `detonator` | Closes with verdict | "thanks for watching" |

**Strategy definitions:**
- **detonator**: Build to dramatic close, main question answered definitively
- **mirror**: Reflect question back to viewer, no definitive answer
- **soft_landing**: Gentle recap/summary, clear resolution without drama

## Output

```yaml
enhancements:
  pattern_interrupts:
    - zone: "post_hook"
      at_beat: "BEAT_03"
      risk_level: "HIGH"
      natural_interrupt: false
      prescribed_type: "format_shift"
      suggestion: "Transition from setup to first evidence with visual example"
    - zone: "mid_video"
      at_beat: "BEAT_05"
      risk_level: "MEDIUM"
      natural_interrupt: true
      prescribed_type: null
      suggestion: null

  end_behavior:
    strategy: "detonator"
    main_loop_closes_at: "BEAT_07"
    final_beat_instruction: "Answer the main question definitively with evidence callback"
    forbidden_phrases: ["in conclusion", "to summarize", "thanks for watching"]

  validation:
    interrupts_covered: true
    end_strategy_valid: true
```

## Error Handling

### On Unknown Content Class for End Behavior
- Log: `{warning: "UNKNOWN_CONTENT_CLASS", value: "[class]"}`
- Action: Default to `soft_landing`, flag `end_strategy_valid: false`

### On Beat Count Too Low for Interrupts
- Log: `{info: "INSUFFICIENT_BEATS", beat_count: 3}`
- Action: Skip mid_video and pre_climax zones, only place post_hook

## Contract Test

**Input:**
```yaml
forward_pull:
  engine_used: "open_loops"
  loops:
    main: { question: "Why?", opens_at: "BEAT_01", closes_at: "BEAT_07" }
    supporting:
      - id: "L_SUP_01"
        question: "Who benefits?"
        opens_at: "BEAT_02"
        closes_at: "BEAT_05"
validated_input:
  beats: [8 beats]
  beat_count: 8
  content_class: "investigation"
```

**Expected Output:**
```yaml
enhancements:
  pattern_interrupts:
    - zone: "post_hook"
      at_beat: "BEAT_03"
      risk_level: "HIGH"
      # ...
  end_behavior:
    strategy: "detonator"
    main_loop_closes_at: "BEAT_07"
    forbidden_phrases: ["in conclusion", "to summarize", "thanks for watching"]
  validation:
    interrupts_covered: true
    end_strategy_valid: true
```

## Pipeline Context Update

Add to `step_history`:
```yaml
- step: "3B-4"
  status: "complete"
  duration_ms: int
  output_summary: "interrupts=3, end=detonator"
```

## Next Step
Pass `enhancements` + all previous context to Step 3B-5 (Assembly).
