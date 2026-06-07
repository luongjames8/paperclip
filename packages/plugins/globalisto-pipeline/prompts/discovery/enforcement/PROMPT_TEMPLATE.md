# Discovery Module: Prompt Template

This document defines the exact wrapper format Node sends to the LLM for each step.

---

## Template Structure

Every step prompt follows this structure:

```
# STEP {{STEP_ID}}: {{STEP_NAME}}

## CONTEXT

topic: {{TOPIC}}
mode: {{MODE}}
iteration: {{ITERATION}}
phase: {{PHASE}}

## INPUT

{{INPUT_DATA_AS_YAML}}

## SINGLE CONCERN

{{STEP_PROMPT_CONTENT}}

## OUTPUT FORMAT

Return YAML only, no other text:

```yaml
{{EXPECTED_OUTPUT_STRUCTURE}}
```

## CONSTRAINTS

- Do not reference information not provided in INPUT
- Output must match the expected schema exactly
- Your output will be validated; invalid output will be rejected
```

---

## Step Templates

### Step 1a: Frame Topic

```
# STEP 1a: FRAME TOPIC

## CONTEXT

topic: {{topic}}
audience_context: {{audience_context}}

## SINGLE CONCERN

Identify 4-6 aspects of this topic where people might hold strong beliefs.
Focus on areas with potential for misconceptions or contested views.

## OUTPUT FORMAT

```yaml
aspects:
  - "Aspect 1 description"
  - "Aspect 2 description"
  # 4-6 total
```
```

### Step 1b: Generate Beliefs

```
# STEP 1b: GENERATE BELIEFS

## CONTEXT

topic: {{topic}}
audience_context: {{audience_context}}

## INPUT

### aspects

```yaml
{{aspects_as_yaml}}
```

## SINGLE CONCERN

For each aspect, predict 1-2 beliefs that the target audience likely holds.
These are TOP-DOWN predictions - what you expect to find, not what you've found.

## OUTPUT FORMAT

```yaml
expected_beliefs:
  - id: EB_01
    belief: "Specific belief statement"
    aspect: "Which aspect this relates to"
    predicted_by: top_down
  # 5-10 total
```
```

### Step 2b: Extract Items

```
# STEP 2b: EXTRACT ITEMS

## CONTEXT

topic: {{topic}}
iteration: {{iteration}}
time_window_months: {{time_window_months}}

## INPUT

### websearch_results

```yaml
{{websearch_results_as_yaml}}
```

### fetched_pages

```yaml
{{fetched_pages_as_yaml}}
```

## SINGLE CONCERN

Extract discourse items from the search results and fetched content.
Each item is a distinct statement showing what someone believes or claims.

## OUTPUT FORMAT

If sufficient items:
```yaml
status: SUFFICIENT
discourse_items:
  - id: D_01
    content: "Exact quote or paraphrase of what was said"
    source: "Source name"
    source_type: reddit | forum | article | blog | youtube | wiki | other
    url: "https://..."
    date: "YYYY-MM-DD"  # if available
    is_hot: true | false  # within hot_threshold_months
  # 15+ items needed
```

If insufficient items:
```yaml
status: INSUFFICIENT
discourse_items: [...]  # what we have so far
gaps:
  - "Missing source type X"
  - "Need more items from Y"
recommendation: "Generate queries targeting Z"
```
```

### Step 2c: Identify Beliefs

```
# STEP 2c: IDENTIFY BELIEFS

## INPUT

### discourse_items

```yaml
{{discourse_items_as_yaml}}
```

## SINGLE CONCERN

Identify distinct beliefs expressed across these discourse items.
Group similar statements into belief clusters.
Do NOT reference any expected beliefs - work only from the data provided.

## OUTPUT FORMAT

```yaml
found_beliefs:
  - id: FB_01
    belief: "The specific belief statement"
    supporting_items:
      - D_01
      - D_05
    found_by: bottom_up
  # All distinct beliefs found
```
```

### Step 4a: Classify Item

```
# STEP 4a: CLASSIFY ITEM

## INPUT

### item

```yaml
{{single_item_as_yaml}}
```

### belief_context

{{belief_being_validated}}

## SINGLE CONCERN

Classify this single discourse item's relationship to the belief.

- SINCERE: Person stating or defending the belief genuinely
- STRAWMAN: Person attacking a caricature no one holds
- NEUTRAL: Descriptive, not taking position

## OUTPUT FORMAT

```yaml
classifications:
  - item_id: {{item_id}}
    classification: SINCERE | STRAWMAN | NEUTRAL
    confidence: HIGH | MEDIUM | LOW
    reasoning: "Brief explanation"
```
```

### Step 4b: Score Bonafide

```
# STEP 4b: SCORE BONAFIDE

## INPUT

### belief

{{belief}}

### classifications

```yaml
{{classifications_as_yaml}}
```

## SINGLE CONCERN

Score whether this belief is bonafide (people actually hold it NOW).

Scoring rules:
- HIGH: 3+ SINCERE items from 2+ sources
- MEDIUM: 1-2 SINCERE items OR single source with 3+ items
- LOW: 0 SINCERE items (all strawman/neutral)

## OUTPUT FORMAT

```yaml
bonafide:
  level: HIGH | MEDIUM | LOW
  sincere_count: N
  strawman_count: N
  neutral_count: N
  source_count: N
  reasons:
    - "Reason 1"
    - "Reason 2"
```
```

### Step 4c: Evaluate Interest

```
# STEP 4c: EVALUATE INTEREST

## INPUT

### belief

{{belief}}

### discourse_items

```yaml
{{relevant_discourse_items_as_yaml}}
```

### source_path

{{source_path}}

### novelty

{{novelty}}

## SINGLE CONCERN

Evaluate how interesting/timely this belief is for content.

Consider:
- Recency of discourse
- Activity level
- Surprise value (is this novel or obvious?)

## OUTPUT FORMAT

```yaml
interest:
  level: HIGH | MEDIUM | LOW
  recency: HOT | WARM | STALE
  surprise_value: HIGH | MEDIUM | LOW
  reasons:
    - "Reason 1"
```
```

### Step 4d: Make Decision

```
# STEP 4d: MAKE DECISION

## INPUT

### belief

{{belief}}

### bonafide

```yaml
{{bonafide_as_yaml}}
```

### interest

```yaml
{{interest_as_yaml}}
```

### source_path

{{source_path}}

### novelty

{{novelty}}

### classification_summary

sincere: {{sincere_count}}
strawman: {{strawman_count}}
neutral: {{neutral_count}}

## SINGLE CONCERN

Make validation decision for this belief.

Decision rules:
- NO-GO if bonafide=LOW
- NO-GO if interest=LOW
- GO if bonafide≥MEDIUM AND interest≥MEDIUM
- PRIORITY if bonafide=HIGH AND interest=HIGH AND recency=HOT

Priority ranking (1=best):
1. bottom_up_only + INTERESTING
2. intersection + INTERESTING
3. bottom_up_only + PREDICTABLE
4. intersection + PREDICTABLE
5. top_down_only + any

## OUTPUT FORMAT

```yaml
decision: GO | NO-GO | PRIORITY
priority_rank: 1-5
reasons:
  - "Reason 1"
```

NOTE: Your decision will be verified by a gate. LOW bonafide or LOW interest
will be overridden to NO-GO regardless of your reasoning.
```

### Step 5c: Evaluate Survival

```
# STEP 5c: EVALUATE SURVIVAL

## INPUT

### belief

{{belief}}

### invalidators

```yaml
{{invalidators_as_yaml}}
```

## SINGLE CONCERN

Determine if the belief survives the invalidation attempt.

- SURVIVES: No strong invalidators, belief holds
- WOUNDED: Has issues but can be refined (provide refined_belief)
- KILLED: Fatally flawed, cannot proceed

CRITICAL: If you refine the belief, it must be SHARPER, not vaguer.
Do NOT add hedges like "sometimes", "often", "in some cases".

## OUTPUT FORMAT

```yaml
verdict: SURVIVES | WOUNDED | KILLED
refined_belief: "Only if WOUNDED - must be sharper than original"
reasons:
  - "Reason 1"
```

NOTE: Your verdict will be verified:
- 2+ STRONG invalidators cannot result in SURVIVES
- 3+ STRONG invalidators force KILLED
- Adding hedge words forces KILLED
```

---

## Data Injection Rules

1. **All data inline:** Embed content directly, don't reference files
2. **YAML format:** Use YAML for structured data (readable, parseable)
3. **No cross-step bleeding:** Only include data the step should see
4. **Validate before send:** Ensure input conforms to expected schema

---

## Example Complete Prompt

```
# STEP 4d: MAKE DECISION

## INPUT

### belief

"Japanese workers are the most overworked in the world"

### bonafide

```yaml
level: MEDIUM
sincere_count: 2
strawman_count: 1
neutral_count: 3
source_count: 3
reasons:
  - "Found sincere statements on Reddit and news articles"
  - "Some strawman usage in older forum posts"
```

### interest

```yaml
level: HIGH
recency: HOT
surprise_value: MEDIUM
reasons:
  - "Recent articles (2024) discussing work reform"
  - "Active Reddit discussions"
```

### source_path

intersection

### novelty

PREDICTABLE

### classification_summary

sincere: 2
strawman: 1
neutral: 3

## SINGLE CONCERN

Make validation decision for this belief.

Decision rules:
- NO-GO if bonafide=LOW
- NO-GO if interest=LOW
- GO if bonafide≥MEDIUM AND interest≥MEDIUM
- PRIORITY if bonafide=HIGH AND interest=HIGH AND recency=HOT

Priority ranking (1=best):
1. bottom_up_only + INTERESTING
2. intersection + INTERESTING
3. bottom_up_only + PREDICTABLE
4. intersection + PREDICTABLE
5. top_down_only + any

## OUTPUT FORMAT

```yaml
decision: GO | NO-GO | PRIORITY
priority_rank: 1-5
reasons:
  - "Reason 1"
```

NOTE: Your decision will be verified by a gate. LOW bonafide or LOW interest
will be overridden to NO-GO regardless of your reasoning.
```

---

## Prompt Construction Code

```typescript
function buildPrompt(stepId: string, context: ContextPack, stepContent: string): string {
  const restrictedData = getRestrictedDataForStep(stepId, context);

  return `# STEP ${stepId}: ${getStepName(stepId)}

## CONTEXT

topic: ${context.topic}
mode: ${context.mode}
iteration: ${context.iteration}
phase: ${context.phase}

## INPUT

${yaml.dump(restrictedData)}

## SINGLE CONCERN

${stepContent}

## OUTPUT FORMAT

Return YAML only, no other text.

NOTE: Your output will be validated against a schema and verified by a gate.
Invalid or inconsistent output will be rejected or overridden.`;
}
```
