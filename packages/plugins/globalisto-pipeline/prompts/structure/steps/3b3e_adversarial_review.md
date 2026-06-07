# Step 3B-3e: Adversarial Review

**Version:** 1.0
**Last Updated:** 2026-01-22

## Purpose
Stress-test engagement strategy before enhancement. Act as skeptical viewer to find weaknesses relative to what works in context.

## Data Contract

### Input Schema
```yaml
forward_pull:
  engine_used: string
  # Engine-specific output (loops, emotional_arc, value_density, or identity_tribe)
hook_zone:
  strength: "HIGH" | "MEDIUM" | "LOW"
  stakes: object
  curiosity_gap: object
validated_input:
  beats: array
  beat_count: int
  content_class: string
pipeline_context: object

# Optional - enhances review quality significantly
historical_context:
  similar_content_performance:
    avg_retention_at_30s: float
    avg_retention_at_2min: float
    avg_apv: float
  competitor_patterns:
    - title: string
      hook_technique: string
      estimated_performance: string
  past_failures:
    - pattern: string
      outcome: string
```

### Output Schema
```yaml
adversarial_review:
  persona_used: string
  drop_off_predictions: array
  hook_weaknesses: array
  engagement_gaps: array
  actionable_fixes: array
  scoring:
    critical_count: int
    warning_count: int
    minor_count: int
    total_score: int
  severity: "CRITICAL" | "WARNING" | "MINOR"
  proceed: bool
  halt_type: "none" | "soft" | "hard"
  iteration: int
```

## Logic

### 1. Persona Selection

**Primary persona** (always active):
> **Skeptical Viewer**: Has 50 browser tabs open, finger hovering over "back" button, has seen hundreds of similar videos, immune to obvious clickbait.

**Secondary persona** (by content class):

| Content Class | Secondary Persona | Focus |
|---------------|-------------------|-------|
| tutorial, guide, analysis | **Domain Skeptic** | "Is this actually accurate? Credible?" |
| investigation, explainer | **Seen-It-All** | "What's new here? Haven't I heard this?" |
| commentary, opinion | **Devil's Advocate** | "What's the counterargument? Too one-sided?" |
| profile, documentary, story | **Emotional Guard** | "Am I being manipulated? Is this authentic?" |
| listicle, review | **Efficiency Expert** | "Is this worth my time? Get to the point." |

```yaml
persona_used: "Skeptical Viewer + [Secondary based on content_class]"
```

### 2. Review Checkpoints

Standard checkpoints for adversarial review:

```
checkpoints = [
  { time: "0:30", beat_range: "2-3", risk: "commitment_decision" },
  { time: "2:00", beat_range: "4-5", risk: "repetition_fatigue" },
  { time: "midpoint", beat_range: "mid", risk: "payoff_doubt" },
  { time: "pre_climax", beat_range: "n-1", risk: "premature_exit" }
]
```

### 3. Hook Zone Attack

For beats 1-2, ask through BOTH personas:

**Skeptical Viewer questions:**
- "What is the **cheapest, most obvious answer** to the question posed?"
- "Why would I NOT believe this matters to me?"
- "Have I seen this exact hook 100 times before?"
- "What would make me say 'I already know where this is going'?"

**Secondary persona questions (examples):**
- Domain Skeptic: "Is this claim actually supported? Source?"
- Seen-It-All: "How is this different from [common video on topic]?"
- Devil's Advocate: "What's the obvious counterpoint being ignored?"

**Competitive analysis (if historical_context provided):**
- "How does this hook compare to top performers in this niche?"
- "What technique are competitors using that we're missing?"

Output:
```yaml
hook_weaknesses:
  - weakness: "[specific issue]"
    evidence: "[quote from beat]"
    detected_by: "skeptical_viewer" | "[secondary_persona]"
    competitive_gap: "[what competitors do better]"  # if historical_context
    fix_suggestion: "[concrete improvement]"
    severity: "CRITICAL" | "WARNING" | "MINOR"
```

### 4. Drop-off Prediction

For each checkpoint, simulate viewer decision:

| Question | Purpose |
|----------|---------|
| "Am I committed yet? Why would I leave now?" | Identify weak transitions |
| "Is this still surprising me? Or getting repetitive?" | Detect pattern fatigue |
| "Do I trust the payoff is coming?" | Measure promise credibility |
| "Do I already know the answer? Why wait?" | Catch premature resolution |

**With historical context:**
- Compare predicted drop-off to `similar_content_performance`
- Flag if predicted retention < historical average by >10%

Output:
```yaml
drop_off_predictions:
  - checkpoint: "0:30"
    beat: "BEAT_02"
    exit_reason: "[why viewer leaves]"
    confidence: "HIGH" | "MEDIUM" | "LOW"
    historical_comparison: "below_average" | "average" | "above_average"
    mitigation: "[how to prevent]"
    severity: "CRITICAL" | "WARNING" | "MINOR"
```

### 5. Engagement Gap Analysis

Find segments that rely on already-invested viewers:

- "Which beat assumes I care without earning it?"
- "Where does the energy/pacing drop?"
- "Which tease feels like a delay tactic rather than genuine anticipation?"
- "Which insight is repeated rather than new?"

Output:
```yaml
engagement_gaps:
  - beat: "BEAT_05"
    issue: "[what's wrong]"
    type: "assumption" | "pacing" | "empty_tease" | "repetition"
    detected_by: "[persona]"
    fix_suggestion: "[improvement]"
    severity: "CRITICAL" | "WARNING" | "MINOR"
```

### 6. Weighted Scoring

Calculate total issue score:

```
FOR each issue IN (hook_weaknesses + drop_off_predictions + engagement_gaps):
  IF issue.severity == "CRITICAL": score += 10
  ELIF issue.severity == "WARNING": score += 3
  ELIF issue.severity == "MINOR": score += 1

total_score = sum(all scores)
```

**Severity assignment rules:**
- CRITICAL: Affects first 30 seconds OR predicted >20% drop OR factual/credibility issue
- WARNING: Affects minutes 1-3 OR predicted 10-20% drop OR pacing issue
- MINOR: Affects later content OR predicted <10% drop OR stylistic issue

### 7. Proceed Decision

```
# Hard halt - fatal issues, cannot proceed
IF total_score >= 20:
  proceed = false
  halt_type = "hard"
  severity = "CRITICAL"

# Hard halt - hook is broken (first 30s issues)
ELIF any(issue.severity == "CRITICAL" AND issue.beat IN ["BEAT_01", "BEAT_02"]):
  proceed = false
  halt_type = "hard"
  severity = "CRITICAL"

# Soft halt - significant issues, human review recommended
ELIF total_score >= 12:
  proceed = false
  halt_type = "soft"
  severity = "WARNING"

# Flagged but proceed - minor issues
ELIF total_score >= 5:
  proceed = true
  halt_type = "none"
  severity = "WARNING"

# Clean - proceed normally
ELSE:
  proceed = true
  halt_type = "none"
  severity = "MINOR"
```

**Halt type definitions:**
- `hard`: Pipeline stops, requires revision and re-run of 3B-3
- `soft`: Pipeline pauses, human can override with justification
- `none`: Pipeline continues, issues logged for optional fixes

### 8. Synthesize Actionable Fixes

Prioritize fixes by impact score:

```yaml
actionable_fixes:
  - priority: 1
    target: "BEAT_01"
    issue_summary: "[what's wrong]"
    fix: "[specific, implementable action]"
    expected_impact: "Reduces 0:30 drop-off by ~15%"
    severity: "CRITICAL"
```

**Fix quality requirements:**
- Must be specific and implementable (not "make it better")
- Must reference exact beat/timestamp
- Should include expected impact estimate

## Output

```yaml
adversarial_review:
  metadata:
    persona_used: "Skeptical Viewer + Domain Skeptic"
    checkpoints_used: ["0:30", "2:00", "midpoint", "pre_climax"]
    historical_context_available: true
    iteration: 1

  hook_weaknesses:
    - weakness: "Stakes feel generic - 'millions of people' is abstract"
      evidence: "Millions of people struggle with..."
      detected_by: "skeptical_viewer"
      competitive_gap: "Top performers use specific person stories"
      fix_suggestion: "Replace with specific person or 'you' statement"
      severity: "WARNING"

  drop_off_predictions:
    - checkpoint: "0:30"
      beat: "BEAT_02"
      exit_reason: "Setup feels like every other explainer"
      confidence: "MEDIUM"
      historical_comparison: "below_average"
      mitigation: "Add unexpected fact or counterintuitive claim"
      severity: "WARNING"
    - checkpoint: "2:00"
      beat: "BEAT_04"
      exit_reason: "Evidence feels like a list, no narrative tension"
      confidence: "HIGH"
      historical_comparison: "average"
      mitigation: "Introduce supporting question (L_SUP) here"
      severity: "WARNING"

  engagement_gaps:
    - beat: "BEAT_05"
      issue: "Assumes viewer cares about technical details"
      type: "assumption"
      detected_by: "domain_skeptic"
      fix_suggestion: "Connect back to viewer's life before diving in"
      severity: "MINOR"

  actionable_fixes:
    - priority: 1
      target: "BEAT_01"
      issue_summary: "Abstract stakes don't create personal connection"
      fix: "Replace 'Millions of people' with 'You've probably felt this...'"
      expected_impact: "Improves 0:30 retention by ~10%"
      severity: "WARNING"
    - priority: 2
      target: "BEAT_04"
      issue_summary: "Evidence dump without narrative tension"
      fix: "Open L_SUP_01 before presenting evidence list"
      expected_impact: "Reduces 2:00 drop-off"
      severity: "WARNING"
    - priority: 3
      target: "BEAT_05"
      issue_summary: "Technical detail without viewer connection"
      fix: "Add 'Here's why this matters to you:' transition"
      expected_impact: "Minor pacing improvement"
      severity: "MINOR"

  scoring:
    critical_count: 0
    warning_count: 3
    minor_count: 1
    total_score: 10  # (0*10) + (3*3) + (1*1)

  severity: "WARNING"
  proceed: true
  halt_type: "none"

  validation:
    review_complete: true
    all_checkpoints_evaluated: true
    actionable_fixes_generated: true
    historical_context_used: true
```

## Error Handling

### On Cannot Identify Weaknesses
- Log: `{warning: "NO_WEAKNESSES_FOUND", message: "Content may be strong or review incomplete"}`
- Action: Return with empty arrays, `proceed: true`, add `review_confidence: "LOW"`

### On All Critical Issues (Hard Halt)
- Log: `{error: "HARD_HALT", total_score: N, critical_in_hook: true}`
- Action: Return `proceed: false`, `halt_type: "hard"`
- Include: Detailed fix suggestions for revision

### On Soft Halt
- Log: `{warning: "SOFT_HALT", total_score: N, message: "Human review recommended"}`
- Action: Return `proceed: false`, `halt_type: "soft"`
- Include: Override format for human to acknowledge and proceed

### On No Historical Context
- Log: `{info: "NO_HISTORICAL_CONTEXT", message: "Review based on heuristics only"}`
- Action: Continue without competitive comparison, note in output

## Multiple Passes Support

If content is revised after adversarial review:

```yaml
# On re-run after revision:
adversarial_review:
  metadata:
    iteration: 2  # Incremented
    previous_issues_resolved: ["BEAT_01 stakes", "BEAT_04 tension"]
    new_issues_found: []
```

Track iteration count to prevent infinite revision loops:
```
IF iteration >= 3 AND still has CRITICAL issues:
  Log: {warning: "REVISION_LOOP", message: "3+ iterations without resolution"}
  Action: Force human intervention
```

## Reviewer Calibration

**For future improvement:**

After content is published, compare predictions to actual retention:
```yaml
calibration_feedback:
  predicted_drop_at_30s: 0.25
  actual_drop_at_30s: 0.22
  prediction_accuracy: "GOOD"  # within 5%

  false_positives:  # Flagged but wasn't actually a problem
    - beat: "BEAT_05"
      predicted_issue: "assumption"
      actual_retention: "no_drop"

  false_negatives:  # Missed issue that caused real drop
    - beat: "BEAT_06"
      missed_issue: "pacing_drop"
      actual_retention: "significant_drop"
```

Use calibration data to refine:
- Severity thresholds
- Checkpoint focus areas
- Persona effectiveness

## Contract Tests

**Input (Weak Hook - Hard Halt):**
```yaml
hook_zone:
  strength: "LOW"
  stakes: { present: false }
  curiosity_gap: { present: false }
validated_input:
  content_class: "explainer"
```

**Expected Output:**
```yaml
adversarial_review:
  hook_weaknesses:
    - weakness: "No stakes or curiosity gap - nothing pulls viewer in"
      severity: "CRITICAL"
  scoring:
    critical_count: 1
    total_score: 10
  severity: "CRITICAL"
  proceed: false
  halt_type: "hard"
```

---

**Input (Medium Issues - Soft Halt):**
```yaml
hook_zone:
  strength: "MEDIUM"
  stakes: { present: true, evidence: "Millions of people..." }
  curiosity_gap: { present: false }
forward_pull:
  engine_used: "open_loops"
  loops:
    main: { question: "Why does this happen?" }
validated_input:
  content_class: "investigation"
```

**Expected Output:**
```yaml
adversarial_review:
  hook_weaknesses:
    - weakness: "Abstract stakes - 'millions' doesn't create personal connection"
      severity: "WARNING"
    - weakness: "No curiosity gap - question is generic"
      severity: "WARNING"
  drop_off_predictions:
    - checkpoint: "0:30"
      severity: "WARNING"
    - checkpoint: "2:00"
      severity: "WARNING"
  scoring:
    warning_count: 4
    total_score: 12
  severity: "WARNING"
  proceed: false
  halt_type: "soft"
```

---

**Input (Strong Hook - Proceed):**
```yaml
hook_zone:
  strength: "HIGH"
  stakes: { present: true, evidence: "Your retirement savings could vanish..." }
  curiosity_gap: { present: true, evidence: "But what nobody tells you..." }
validated_input:
  content_class: "investigation"
```

**Expected Output:**
```yaml
adversarial_review:
  hook_weaknesses: []
  drop_off_predictions:
    - checkpoint: "2:00"
      exit_reason: "Mid-video pacing risk"
      severity: "MINOR"
  scoring:
    minor_count: 1
    total_score: 1
  severity: "MINOR"
  proceed: true
  halt_type: "none"
```

## Pipeline Context Update

Add to `step_history`:
```yaml
- step: "3B-3e"
  status: "complete"
  duration_ms: int
  output_summary: "score=10, severity=WARNING, proceed=true, fixes=3"
```

## Override Format (for Soft Halt)

When `halt_type: "soft"`, human can proceed with:
```yaml
override:
  approved: true
  approver: "[name]"
  justification: "[why proceeding despite issues]"
  acknowledged_issues:
    - "Abstract stakes in BEAT_01"
    - "Pacing drop at BEAT_04"
  accepted_risk: true
```

## Next Step

- If `proceed: true`: Pass to Step 3B-4 (Enhancements) with `actionable_fixes`
- If `halt_type: "soft"`: Wait for human override, then proceed or revise
- If `halt_type: "hard"`: Return to Step 3B-2 or 3B-3 for revision, then re-run 3B-3e
