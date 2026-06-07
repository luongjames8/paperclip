# Discovery Module: Enforcement Specification

## Overview

This document specifies the deterministic enforcement layer for the Discovery Module. The key principle is:

**LLM executes steps; Node enforces gates.**

The LLM cannot be trusted to enforce its own constraints. Node gates provide deterministic enforcement that Claude Code MUST respect.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLAUDE CODE (ORCHESTRATOR)                                         │
│  ─────────────────────────────                                      │
│  • Reads step prompts (just-in-time)                                │
│  • Executes LLM calls (Opus for reasoning, DeepSeek for fetch)      │
│  • Calls Node gates via Bash after each step                        │
│  • MUST respect BLOCK decisions (non-negotiable)                    │
│  • Writes artifacts, manages state                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼ (after each step output)
┌─────────────────────────────────────────────────────────────────────┐
│  NODE GATES (LIBRARY FUNCTIONS)                                     │
│  ───────────────────────────────                                    │
│  Invoked via: npx ts-node gates.ts <gate> '<json-input>'            │
│                                                                     │
│  Returns: { pass: boolean, reasons: string[], override?: {...} }    │
│                                                                     │
│  If pass=false → Claude MUST respect (override LLM, stop, or loop)  │
│  If override → Claude MUST apply the override value                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## State Machine

```
States: INIT → PHASE_1 → PHASE_2 → PHASE_3 → PHASE_4 → PHASE_5 → PHASE_6 → SUCCESS
                  ↑           │                  │           │
                  └───────────┴──────────────────┴───────────┘ (loops)

Terminal States:
  - SUCCESS           Pipeline completed successfully
  - FAILED_NO_BELIEFS All beliefs killed, no viable candidates
  - FAILED_INSUFFICIENT Could not gather sufficient discourse
  - BLOCKED           Gate blocked execution (terminal failure)
```

### State Transitions

| From State | Trigger | To State |
|------------|---------|----------|
| INIT | `init` command | PHASE_1 (topic_first) or PHASE_4 (belief_first) |
| PHASE_1 | Step 1b complete | PHASE_2 (parallel) |
| PHASE_2 | Sufficiency gate pass | PHASE_3 |
| PHASE_2 | Sufficiency gate fail (max iter) | FAILED_INSUFFICIENT |
| PHASE_3 | Step 3b complete | PHASE_4 |
| PHASE_4 | All candidates NO-GO | PHASE_1 (retry) or FAILED_NO_BELIEFS |
| PHASE_4 | At least one GO | PHASE_5 |
| PHASE_5 | At least one SURVIVES/WOUNDED | PHASE_6 |
| PHASE_5 | All KILLED | PHASE_1 (retry) or FAILED_NO_BELIEFS |
| PHASE_6 | Step 6c complete | SUCCESS |
| Any | BLOCK action | BLOCKED |

---

## Gates

### Gate: Sufficiency (`gateSufficiency`)

**Location:** After step 2b
**Purpose:** Ensure sufficient discourse items before proceeding

| Check | Threshold | On Fail |
|-------|-----------|---------|
| Total items | ≥ 15 | Loop to 2a |
| Reddit/forum items | ≥ 5 | Loop to 2a |
| Fetched items | ≥ 3 | Loop to 2a |
| Source types | ≥ 3 | Loop to 2a |
| Max iterations | 3 | STOP |

```typescript
interface SufficiencyInput {
  discourse_items: DiscourseItem[];
  iteration: number;
  config?: { min_items, min_reddit_forum, min_fetched, min_source_types, max_iterations };
}
```

### Gate: Novelty (`gateNovelty`)

**Location:** After step 2d
**Purpose:** Ensure we have INTERESTING beliefs or max iterations reached

| Check | Condition | Action |
|-------|-----------|--------|
| Has INTERESTING | Any belief rated INTERESTING | CONTINUE |
| Max iterations | iteration ≥ 3 | CONTINUE (with PREDICTABLE) |
| Neither | No INTERESTING, iteration < 3 | LOOP to 2a |

### Gate: Bonafide (`gateBonafide`)

**Location:** After step 4d
**Purpose:** Enforce bonafide decision rules deterministically

| Condition | Decision | Override |
|-----------|----------|----------|
| LOW bonafide | Force NO-GO | Yes |
| LOW interest | Force NO-GO | Yes |
| LLM said GO but above conditions | Override to NO-GO | Yes |

**This gate cannot be rationalized.** LOW bonafide = NO-GO, period.

### Gate: Interesting Veto (`gateInterestingVeto`)

**Location:** After step 4d
**Purpose:** Deprioritize PREDICTABLE when INTERESTING exists

If INTERESTING candidates exist, PREDICTABLE candidates are vetoed.

### Gate: Survival (`gateSurvival`)

**Location:** After step 5c
**Purpose:** Validate survival verdict consistency

| Strong Invalidators | Verdict | Action |
|--------------------|---------|--------|
| 0-1 | Any | Accept |
| 2 | SURVIVES | Override to WOUNDED |
| 3+ | SURVIVES or WOUNDED | Override to KILLED |

### Gate: Refinement Sharpness (`gateRefinementSharpness`)

**Location:** After step 5c (if WOUNDED)
**Purpose:** Ensure refined belief is sharper, not vaguer

Checks for:
- Vague qualifiers: "sometimes", "often", "usually", "generally"
- Hedge patterns: "in some cases", "depending on"
- Length increase > 50%

Failure → Override verdict to KILLED

### Gate: Shape (`gateShape`)

**Location:** Before step 6a
**Purpose:** Reject beliefs with banned forms

Banned patterns:
- Moral verdicts: "is good/bad/wrong/right"
- Analogies: "is like X because"
- Prescriptions: "should be"

Failure → BLOCK (requires reformulation)

### Gate: All Killed (`gateAllKilled`)

**Location:** After Phase 5 complete
**Purpose:** Handle case where all candidates were killed

| Condition | Action |
|-----------|--------|
| Survivors exist | CONTINUE |
| All killed, coverage changed, retries < 2 | LOOP to PHASE_1 |
| All killed, max retries reached | BLOCK |

---

## Artifact Store

The artifact store provides immutable audit trail for all pipeline outputs.

### Interface

```typescript
interface ArtifactStore {
  write(stepId: string, payload: unknown): { artifactId: string; hash: string };
  freeze(artifactId: string): void;
  load(artifactId: string): unknown;  // Throws if modified after freeze
  getHashChain(): string[];  // For audit verification
}
```

### Semantics

1. **Append-only:** New artifacts are always appended, never overwritten
2. **Hash chain:** Each artifact hash includes previous hash for tamper detection
3. **Freeze:** Once frozen, any modification attempt throws an error
4. **Persistence:** Stored as YAML file for inspection

### Usage

```bash
# Verify artifact integrity
npx ts-node artifact-store.ts verify .discovery_artifacts.yaml
```

---

## Verifier

The verifier runs at checkpoints to verify pipeline integrity. It operates on **structured artifacts only** - no prose, no LLM reasoning.

### Checkpoints

| Checkpoint | Location | Verifies |
|------------|----------|----------|
| `after_2b` | After sufficiency | Item counts, duplicates, suspicious similarities |
| `after_4d` | After decision | Bonafide enforcement, INTERESTING veto |
| `after_5c` | After survival | Verdict consistency, refinement quality |
| `before_6a` | Before slots | Shape violations, meta-commentary |

### Interface

```typescript
interface VerifierResult {
  checkpoint: string;
  passed: boolean;
  reasons: string[];
  override?: { field, original_value, new_value };
  terminal?: boolean;  // If true, STOP pipeline
}
```

### Usage

```bash
npx ts-node verifier.ts after_4d '{"candidate":...,"bonafide":...}'
```

---

## Restricted Views

Role separation prevents LLM from seeing information that could lead to rationalization.

### View Restrictions by Step

| Step | INCLUDES | EXCLUDES |
|------|----------|----------|
| 2c | discourse_items | expected_beliefs, topic_framing |
| 3a | expected_beliefs, found_beliefs | discourse_items |
| 4a | single item, belief_context | other items, scores |
| 4b | belief, classifications | interest_score, decisions |
| 4c | belief, discourse_items, source_path | bonafide_score, classifications |
| 4d | scores, counts, histogram | raw discourse, full artifacts |
| 5c | belief, invalidators | discourse_items, validation_scores |

### Why Restricted Views

1. **Prevent anchoring:** Classification shouldn't see scores
2. **Prevent rationalization:** Decision shouldn't see raw data
3. **Prevent bleeding:** Interest evaluation shouldn't see bonafide
4. **Single concern:** Each step only sees what it needs

---

## CLI Reference

### Initialize Pipeline

```bash
npx ts-node runner.ts init '{"topic":"X","mode":"topic_first"}'
```

### Process Step Output

```bash
npx ts-node runner.ts step 2b '{"status":"SUFFICIENT","discourse_items":[...]}'
```

### Check Status

```bash
npx ts-node runner.ts status
```

### Run Gate Directly

```bash
npx ts-node gates.ts gateBonafide '{"bonafide":{"level":"LOW"},"interest":{"level":"HIGH"},"llm_decision":"GO"}'
# Returns: {"pass":false,"reasons":["OVERRIDE: LOW bonafide forces NO-GO"],"override":{"field":"decision",...}}
```

### Run Verifier

```bash
npx ts-node verifier.ts after_5c '{"survival_result":{...},"original_belief":"..."}'
```

### Finalize

```bash
npx ts-node runner.ts finalize
```

---

## Error Handling

### Gate Failures

When a gate returns `pass: false`:

1. **LOOP action:** Return to specified step, increment iteration
2. **STOP action:** Log failure, try next candidate or path
3. **BLOCK action:** Terminal failure, pipeline cannot continue
4. **OVERRIDE action:** Apply the override, continue with corrected value

### Verifier Failures

When verifier returns `terminal: true`:

1. Pipeline enters BLOCKED state
2. No further processing allowed
3. Debug output includes failure reason

### Recovery

The pipeline supports crash recovery via context persistence:

1. Context saved after each step
2. `loadContext()` restores state
3. Can resume from last successful step

---

## Anti-Rationalization Measures

This enforcement system specifically addresses LLM rationalization:

| Problem | Solution |
|---------|----------|
| LLM rationalizes LOW bonafide | `gateBonafide` forces NO-GO unconditionally |
| LLM adds hedges to survive | `gateRefinementSharpness` checks for vague qualifiers |
| LLM ignores invalidators | `gateSurvival` counts STRONG invalidators |
| LLM sees too much context | `views.ts` restricts data per step |
| LLM modifies past decisions | `artifact-store.ts` freezes artifacts |
| LLM ignores failures | `gateAllKilled` enforces pipeline termination |

---

## Dependencies

```json
{
  "dependencies": {
    "zod": "^3.x",
    "js-yaml": "^4.x"
  }
}
```

Built-in Node modules: `crypto`, `fs`, `path`

---

## Files

| File | Purpose |
|------|---------|
| `types.ts` | TypeScript interfaces |
| `schemas.ts` | Zod validation schemas |
| `artifact-store.ts` | Append-only artifact storage |
| `gates.ts` | Deterministic gate functions |
| `verifier.ts` | Independent checkpoint verifier |
| `views.ts` | Restricted view builders |
| `runner.ts` | Pipeline orchestrator |
| `ENFORCEMENT_SPEC.md` | This document |
| `PROMPT_TEMPLATE.md` | LLM prompt wrapper template |
