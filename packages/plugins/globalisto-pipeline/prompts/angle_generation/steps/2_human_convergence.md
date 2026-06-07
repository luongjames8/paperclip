# STEP 2: HUMAN CONVERGENCE

## PURPOSE
Present all 3 angle proposals to the human for selection. The human picks ONE angle as the locked direction. Runners-up are preserved for potential pivot.

## INPUT
| Input | Source |
|-------|--------|
| `ANGLE_PROPOSAL_A.yaml` | YouTube Strategist proposal |
| `ANGLE_PROPOSAL_B.yaml` | Documentary Filmmaker proposal |
| `ANGLE_PROPOSAL_C.yaml` | Adversarial Journalist proposal |

## PROCESS

1. Read all 3 proposals
2. Present them to the human in a clear comparison format:

For each proposal, display:
- **Title** (bold, prominent)
- **Promise**: one_sentence_promise
- **Thumbnail**: thumbnail_concept
- **Opening hook**: opening_hook
- **Why this works**: reasoning (summarized)
- **Gate results**: pass/fail summary from step 1 gates

3. Ask the human: "Which angle do you want to lock? (A, B, or C)"
4. Record their choice

## OUTPUT

Use the following delimiter format to separate each output file:

```
--- FILE: ANGLE_LOCK.yaml ---
status: provisional
title: "[chosen title]"
one_sentence_promise: "[chosen promise]"
thumbnail_concept: "[chosen thumbnail]"
opening_hook: "[chosen opening hook]"
target_ecosystem: "[chosen ecosystem]"
angle_type: "[chosen type]"
source_agent: "[which agent proposed this]"
source_model: "[which model]"
selected_by: human
gate_results:
  title_length: pass
  serp_audit: pass
  brand_recognition: pass
  preflight_checklist: pass
--- FILE: ANGLE_RUNNERS_UP.yaml ---
runners_up:
  - title: "[runner-up 1 title]"
    one_sentence_promise: "[promise]"
    thumbnail_concept: "[thumbnail]"
    source_agent: "[agent]"
    gate_results: { ... }
  - title: "[runner-up 2 title]"
    one_sentence_promise: "[promise]"
    thumbnail_concept: "[thumbnail]"
    source_agent: "[agent]"
    gate_results: { ... }
```

## HARD CONSTRAINTS
- MUST present raw proposals — no synthesis, no ranking, no recommendation
- Human sees all 3 equally weighted (independent judgment before exposure)
- ALL 3 proposals preserved in runners_up for pivot potential
- Status MUST be "provisional" — not "firm" until post-research validation

## COMPLETION RULE
Done when: Human has selected an angle, ANGLE_LOCK.yaml (provisional) and ANGLE_RUNNERS_UP.yaml are written.

## NEXT STEP
`ANGLE_LOCK.yaml` → Research phase (as additional input to all research steps)
