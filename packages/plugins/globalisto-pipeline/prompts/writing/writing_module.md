# CONTENT WRITING MODULE

## MODEL SELECTION

| Use Case | Model | Rationale |
|----------|-------|-----------|
| Production | Opus | Emotional precision |
| Integration testing | DeepSeek | Fast validation |

Single-pass only. See `MODEL_SELECTION.md` for test results.

---

## PURPOSE

Convert validated structure into prose that executes as FELT EXPERIENCE.

This module writes content section-by-section, following a frozen structure (beat graph, blueprint) while delivering emotional functions precisely.

**This module performs NO analysis, research, or structural decisions.** All structure is frozen upstream.

---

## INPUTS

| Input | Required | Purpose |
|-------|----------|---------|
| `BEAT_GRAPH.yaml` | Yes | Ordered beats with emotional functions (INVARIANT) |
| `NARRATIVE_BLUEPRINT.md` | Yes | Section structure, arc, setups/payoffs (FROZEN) |
| `RESEARCH_MASTER.yaml` | Yes | Facts and quotes with IDs (FINAL) |
| `content_class` | Yes | `detonator` \| `mirror` |
| `medium` | No | `video` (default) \| `article` \| `web_page` |
| `project_config.yaml` | No | Per-project overrides (emotional_rules, ending_logic, evidence_roles) |

---

## QUOTE INJECTION (CRITICAL)

**Problem:** Models will hallucinate quotes if not given the actual quote text.

**Solution:** Before calling `content_execution.md`, the orchestrator MUST:

1. **Extract all quotes** from `research_master.yaml`
2. **Format as injection table:**
   ```
   ## AVAILABLE QUOTES (USE ONLY THESE - NO OTHERS)

   | ID | Speaker | Text |
   |----|---------|------|
   | q_001 | Sarah Ward | "Jobseekers often must choose..." |
   | q_002 | Sarah Ward | "Ideally, you'd want to have..." |
   ```
3. **Inject table** into the prompt context for `content_execution.md`

**Validation:** After writing, verify every quote in output matches an ID from the table. If a quote appears that is NOT in the table, the output FAILS validation.

**Why this matters:** Testing confirmed that without explicit quote injection, models invent plausible-sounding quotes attributed to real sources. This is a critical failure mode.

---

## OUTPUTS

### `DRAFT_CONTENT.md`

The written content with identical structure to blueprint.

### `WRITING_REPORT.yaml`

```yaml
WRITING_REPORT:
  beats_executed: [list of BEAT_IDs]
  beats_missing: []
  sections_written: [count]
  data_points_used: [IDs]
  quotes_used: [IDs]

  confirmation:
    structure_changed: false
    belief_reinterpreted: false
    facts_outside_research_master: false
    class_rules_violated: false

  ready_for_polish: true
```

---

## CONTENT CLASS RULES

### DETONATOR

- Resolution language MUST complete the belief collapse
- Final section MUST resolve the belief explicitly
- No interpretive openness remains
- Viewer leaves with certainty

### MIRROR

- Resolution language advances causality WITHOUT completing belief
- Final section MUST NOT resolve the belief
- At least one tension MUST remain open
- No language may imply fixes, lessons, or prescriptions
- No language may directly judge the viewer

**Violation of class rules = FAIL**

---

## PARAMETERS

### emotional_rules

When `enabled` (default for video):
- Delivery guidance applied per beat type
- INTRIGUE, RECOGNITION, DISCOMFORT, RESISTANCE, COLLAPSE, WEIGHT
- See `steps/content_execution.md` for delivery techniques

When `disabled`:
- Standard prose execution
- Emotional landing deferred to polish phase

### ending_logic

| Value | Behavior |
|-------|----------|
| `collapse_belief` | Final section completes destruction (DETONATOR) |
| `leave_tension` | Final section destabilizes without resolution (MIRROR) |
| `funnel` | Final section drives to action (CTA content) |
| `none` | No special ending treatment |

### evidence_roles (web content only)

| Role | Treatment |
|------|-----------|
| `PRIMARY` | Full treatment - explain, contextualize, establish |
| `REFERENCE` | One sentence + link to primary location |

Not applicable to video/linear content.

---

## EXECUTION

This module runs in one step with pre/post enforcement gates:

### Pre-Gate: Quote Injection Validation

**BEFORE content_execution:** Verify quote table is injected.

```bash
npx tsx prompts/enforcement/cli.ts writing:quote_injection @prompt_context.txt --output-dir .
```

**Input:** `prompt_context.txt` - the full prompt about to be sent to content_execution

```json
{ "prompt_context": "<full prompt text including AVAILABLE QUOTES table>" }
```

**Actions:**
- `CONTINUE`: Quote table found - proceed with content_execution
- `BLOCK`: Quote table not found - STOP and inject `## AVAILABLE QUOTES` table first

**Recovery on BLOCK:**
1. Extract quotes from `research_master.yaml`
2. Format as injection table (see QUOTE INJECTION section above)
3. Inject into prompt context
4. Re-run gate to confirm
5. Proceed to content_execution

---

### Step 1: Content Execution
**Prompt:** `steps/content_execution.md`
**Model:** Opus (production) or DeepSeek (integration testing only)

Execute all sections following beat graph order, applying emotional delivery rules and class constraints.

**Outputs:** `DRAFT_CONTENT.md`, `WRITING_REPORT.yaml`

---

### Post-Gate: Writing Output Validation

**AFTER content_execution:** Verify self-reported confirmation fields.

```bash
npx tsx prompts/enforcement/cli.ts writing:writing_output @outputs.json --output-dir .
```

**Input:** `outputs.json` with writing output data:

```json
{
  "draft_content": "<contents of DRAFT_CONTENT.md>",
  "writing_report": {
    "ready_for_polish": true,
    "beats_executed": ["BEAT_01", "BEAT_02"],
    "quotes_used": ["q_001", "q_002"],
    "data_points_used": ["DP_01"],
    "word_count": 1500
  },
  "beat_graph_ids": ["BEAT_01", "BEAT_02", "BEAT_03"],
  "available_quote_ids": ["q_001", "q_002", "q_003"],
  "available_dp_ids": ["DP_01", "DP_02"]
}
```

**Actions:**
- `CONTINUE`: All validations pass - proceed to Polish
- `BLOCK` with `override`: Discrepancies found - override `ready_for_polish: false`, review issues

**Validations performed:**
- All beats from beat_graph appear in beats_executed
- All quote IDs in report exist in available_quote_ids
- All data point IDs in report exist in available_dp_ids

**Recovery on BLOCK:**
1. Review `reasons` array in gate output for specific discrepancies
2. Address missing beats, invalid quotes, or invalid data points
3. Re-run content_execution if necessary
4. Re-run gate to confirm

---

## HARD CONSTRAINTS (NON-NEGOTIABLE)

This module may NOT:
- Add, remove, or modify beats
- Add new arguments, claims, or facts
- Reinterpret the belief or angle
- Use facts not present in research_master
- Make uncited factual claims

This module MUST:
- Execute every beat exactly once
- Reference research_master IDs for all claims
- Follow tension chain structure (Problem→Consequence→Resolution→New Tension)
- Honor emotional functions from beat graph
- Respect class-specific execution rules

**If something feels missing, STOP and flag upstream failure.**

---

## PRINCIPLES

1. Facts ARE the emotional arc - delivery determines impact
2. Every beat serves the journey - no information-only beats
3. Causality is mandatory - "and then" is forbidden
4. WEIGHT beats need space - don't explain, let them land
5. COLLAPSE beats are short - full stop, room to feel
6. Structure is frozen - execution is the only freedom

---

## INTEGRATION

### Upstream Dependencies
- Structure Module: `BEAT_GRAPH.yaml` (ordered beats, evidence)
- Structure Module: `NARRATIVE_BLUEPRINT.md` (arc, teases, loops)
- Research Module: `RESEARCH_MASTER.yaml` (facts, quotes, sources)

### Downstream
- Polish module (language smoothing)
- Packaging module (titles, thumbnails)

---

*See `MODEL_SELECTION.md` for test results justifying model choices.*