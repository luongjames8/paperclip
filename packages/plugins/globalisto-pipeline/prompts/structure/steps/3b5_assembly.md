# Step 3B-5: Assembly & Validation

**Version:** 1.0
**Last Updated:** 2026-01-22

## Purpose
Assemble all outputs into ENGAGEMENT_STRATEGY.yaml and perform final validation.

## Data Contract

### Input Schema
```yaml
validated_input:
  beats: array
  beat_count: int
  content_class: string
engine_selection:
  primary: string
  supporting: array
  rationale: string
hook_zone:
  strength: "HIGH" | "MEDIUM" | "LOW"
  stakes: object
  curiosity_gap: object
forward_pull:
  engine_used: string
  fallback_used: bool
  # Plus engine-specific output
enhancements:
  tease_points: array
  pattern_interrupts: array
  end_behavior: object
pipeline_context:
  execution_id: string
  mode: "advisory" | "strict"
  step_history: array
  warnings: array
```

### Output Schema
```yaml
ENGAGEMENT_STRATEGY:
  metadata: object
  targets: object
  engine_selection: object
  hook_zone: object
  forward_pull: object  # engine-specific
  enhancements: object
  validation_summary: object
  verdict: "PASS" | "REVIEW" | "OVERRIDE_REQUIRED" | "HALT"
```

## Logic

### 1. Validation Checks

Run all checks and collect results:

| Check | Pass Condition | Severity |
|-------|----------------|----------|
| hook_zone_strength | Not "LOW" | CRITICAL (strict) / WARNING (advisory) |
| forward_pull_complete | Engine output present | CRITICAL |
| loop_coverage_valid | No gaps (if open_loops) | WARNING |
| protagonist_clear | Identified (if emotional_arc) | WARNING |
| density_meets_target | >= 80% of target (if value_density) | WARNING |
| identity_clear | Positioning exists (if identity_tribe) | WARNING |
| tease_points_placed | At least 1 tease | INFO |
| end_behavior_matches | Strategy matches content_class | WARNING |

### 2. Verdict Logic

```
# Count issues by severity
critical_count = count(issues WHERE severity == "CRITICAL")
warning_count = count(issues WHERE severity == "WARNING")

IF mode == "advisory":
  IF critical_count > 0:
    verdict = "REVIEW"
    # Proceeds, but flagged for human review
  ELIF warning_count > 0:
    verdict = "REVIEW"
  ELSE:
    verdict = "PASS"

ELIF mode == "strict":
  IF critical_count > 0:
    verdict = "OVERRIDE_REQUIRED"
    # Blocks progression without explicit override
  ELIF warning_count >= 3:
    verdict = "REVIEW"
  ELSE:
    verdict = "PASS"

# Special case: pipeline already halted
IF pipeline_context.halted == true:
  verdict = "HALT"
```

### 3. Override Mechanism

When `verdict == "OVERRIDE_REQUIRED"`:
```yaml
override_required:
  issues:
    - check: "hook_zone_strength"
      current: "LOW"
      required: "MEDIUM or higher"
      suggestion: "Restructure beats 1-2 to add stakes or curiosity"

  to_proceed: "Add 'override: true' with justification"

  override_format:
    override: true
    justification: "[human explanation]"
    acknowledged_issues: ["hook_zone_strength"]
```

### 4. Assemble Final Output

Combine all step outputs into unified structure.

## Output

```yaml
ENGAGEMENT_STRATEGY:
  metadata:
    version: "1.0"
    execution_id: "[from pipeline_context]"
    generated_at: "[ISO timestamp]"
    mode: "advisory" | "strict"
    content_class: "[from input]"
    beat_count: int

  targets:
    retention_30s: 0.70
    retention_60s: 0.60
    apv: 0.50  # average percentage viewed

  engine_selection:
    primary: "[engine]"
    supporting: []
    rationale: "[why this engine]"

  hook_zone:
    strength: "HIGH" | "MEDIUM" | "LOW"
    stakes:
      present: bool
      type: "[type if present]"
      evidence: "[quote if present]"
    curiosity_gap:
      present: bool
      type: "[type if present]"
      evidence: "[quote if present]"
    suggestion: "[improvement if needed]"

  # Engine-specific section (ONE of these):
  loops:
    main: { question: "...", opens_at: "...", closes_at: "..." }
    supporting: [...]
    coverage_map: { ... }
    gaps: []

  # OR emotional_arc: { ... }
  # OR value_density: { ... }
  # OR identity_tribe: { ... }

  tease_points:
    - after_beat: "[beat]"
      timing_estimate: "[time]"
      suggested_tease: "[text]"

  pattern_interrupts:
    - zone: "[zone]"
      at_beat: "[beat]"
      risk_level: "[level]"
      prescribed_type: "[type]"
      suggestion: "[text]"

  end_behavior:
    strategy: "detonator" | "mirror" | "soft_landing"
    main_loop_closes_at: "[beat]" | "stays_open"
    final_beat_instruction: "[guidance]"
    forbidden_phrases: [...]

  validation_summary:
    checks:
      - name: "hook_zone_strength"
        passed: bool
        value: "[actual value]"
        severity: "CRITICAL" | "WARNING" | "INFO"
      - name: "loop_coverage_valid"
        passed: bool
        value: "[details]"
        severity: "WARNING"
      # ... all checks

    critical_issues: int
    warning_issues: int
    info_issues: int

  verdict: "PASS" | "REVIEW" | "OVERRIDE_REQUIRED" | "HALT"

  # Only present if verdict != "PASS"
  verdict_details:
    blocking_issues: [...]
    suggestions: [...]
    override_format: { ... }  # only if OVERRIDE_REQUIRED

  # Execution trace
  pipeline_trace:
    steps_executed: ["3B-0", "3B-1", "3B-2", "3B-3", "3B-3a", "3B-4", "3B-5"]
    total_duration_ms: int
    warnings_collected: [...]
    fallback_used: bool
```

## Error Handling

### On Missing Required Input
- Log: `{error: "MISSING_INPUT", field: "[field]"}`
- Action: HALT pipeline, set verdict to "HALT"

### On Validation Check Failure
- Log: `{warning: "CHECK_FAILED", check: "[check]", reason: "[why]"}`
- Action: Add to validation_summary, continue assembly

### On Assembly Error
- Log: `{error: "ASSEMBLY_FAILED", reason: "[message]"}`
- Action: Return partial output with `incomplete: true`, verdict = "HALT"

## Contract Test

**Input (Clean - All Checks Pass):**
```yaml
validated_input:
  beats: [8 beats]
  beat_count: 8
  content_class: "investigation"
engine_selection:
  primary: "open_loops"
  supporting: []
hook_zone:
  strength: "HIGH"
  stakes: { present: true }
  curiosity_gap: { present: true }
forward_pull:
  engine_used: "open_loops"
  loops: { main: {...}, supporting: [...] }
enhancements:
  tease_points: [2 teases]
  end_behavior: { strategy: "detonator" }
pipeline_context:
  mode: "advisory"
```

**Expected Output:**
```yaml
ENGAGEMENT_STRATEGY:
  verdict: "PASS"
  validation_summary:
    critical_issues: 0
    warning_issues: 0
```

---

**Input (Issues - Strict Mode):**
```yaml
hook_zone:
  strength: "LOW"  # CRITICAL in strict mode
pipeline_context:
  mode: "strict"
```

**Expected Output:**
```yaml
ENGAGEMENT_STRATEGY:
  verdict: "OVERRIDE_REQUIRED"
  verdict_details:
    blocking_issues:
      - check: "hook_zone_strength"
        current: "LOW"
        required: "MEDIUM or higher"
    override_format:
      override: true
      justification: "[required]"
```

---

**Input (Issues - Advisory Mode):**
```yaml
hook_zone:
  strength: "LOW"  # WARNING in advisory mode
pipeline_context:
  mode: "advisory"
```

**Expected Output:**
```yaml
ENGAGEMENT_STRATEGY:
  verdict: "REVIEW"
  validation_summary:
    warning_issues: 1
  verdict_details:
    suggestions:
      - "Restructure beats 1-2 to add stakes or curiosity gap"
```

## Pipeline Context Update

Add to `step_history`:
```yaml
- step: "3B-5"
  status: "complete"
  duration_ms: int
  output_summary: "verdict=PASS, checks=8/8"
```

## Done

Output `ENGAGEMENT_STRATEGY.yaml` is ready for writing phase consumption.

**File location:** Write to same directory as input script, e.g.:
```
[project]/output/ENGAGEMENT_STRATEGY.yaml
```
