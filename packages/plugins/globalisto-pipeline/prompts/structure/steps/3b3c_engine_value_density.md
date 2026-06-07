# Step 3B-3c: Value Density Engine

**Version:** 1.0
**Last Updated:** 2026-01-22

## Purpose
Design insight-per-minute structure for information-heavy content.

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
value_density:
  target_insights_per_minute: float
  actual_insights_per_minute: float
  insight_map: object
  low_density_beats: array
  signposting: string
```

## Logic

### 1. Calculate Target Density

```
# Baseline target: 2.5 insights per minute

# Adjust by content type
IF content_class == "tutorial": target = 3.0/min  # higher density
IF content_class == "analysis": target = 2.0/min  # more depth per insight
IF content_class == "listicle": target = 3.5/min  # rapid-fire
```

### 2. Count Insights Per Beat

**What counts as an insight:**
- New fact or statistic
- Counterintuitive finding
- Practical tip or technique
- Framework or mental model
- Comparison or contrast
- Cause-effect relationship

**What doesn't count:**
- Repetition of earlier point
- Pure transition/filler
- Emotional appeal without information
- Rhetorical questions (these are loops, not insights)

### 3. Map Insights to Beats

For each beat:
- List distinct insights
- Note if density is below target

### 4. Identify Low-Density Beats

Beats with fewer insights than expected may need:
- Compression (merge with adjacent beat)
- Enhancement (add missing insight)
- Cutting (if truly filler)

### 5. Determine Signposting Strategy

How to help viewer track progress:

| Strategy | Best For | Example |
|----------|----------|---------|
| numbered_list | Listicles, how-tos | "Tip #3..." |
| before_after | Transformations | "Before... now..." |
| problem_solution | Tutorials | "The problem... the fix..." |
| chronological | Analysis | "First... then... finally..." |

## Output

```yaml
value_density:
  target_insights_per_minute: 2.5
  actual_insights_per_minute: 2.3

  insight_map:
    BEAT_01:
      count: 2
      insights:
        - "Tech layoffs hit 262,000 in 2023"
        - "Same phrase used across companies"
    BEAT_02:
      count: 3
      insights:
        - "Pattern started with specific consulting memo"
        - "Memo recommended coordinated messaging"
        - "CEOs share PR advisors"
    BEAT_03:
      count: 1
      insights:
        - "Stock prices rise after layoff announcements"
    # ... etc

  low_density_beats:
    - beat: "BEAT_05"
      current_count: 1
      expected_count: 2
      suggestion: "Add supporting statistic or example"

  signposting: "chronological"

  validation:
    meets_target: true  # actual >= target * 0.8
    no_empty_beats: true
```

## Error Handling

### On Very Low Density
- Log: `{warning: "LOW_DENSITY", actual: 1.2, target: 2.5}`
- Action: Flag all beats below threshold, continue with output

### On Cannot Count Insights
- Log: `{error: "CANNOT_ANALYZE", message: "Beat content unclear"}`
- Action: Return partial, flag specific beats

## Contract Test

**Input:**
```yaml
beats:
  - id: "BEAT_01"
    content: "Here are 5 ways to improve your code reviews."
  - id: "BEAT_02"
    content: "First, always review in small batches. Studies show reviews over 400 lines have 50% lower defect detection."
  # ... more beats
```

**Expected Output:**
```yaml
value_density:
  target_insights_per_minute: 3.0  # tutorial = higher density
  actual_insights_per_minute: 2.8
  insight_map:
    BEAT_01: { count: 1, insights: ["5 ways to improve code reviews"] }
    BEAT_02: { count: 2, insights: ["Small batches", "400-line threshold stat"] }
  low_density_beats: []
  signposting: "numbered_list"
```

## Return to Router
Return `value_density` object to 3B-3 router for assembly.
