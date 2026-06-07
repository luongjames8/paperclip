# 6d: EXPORT RESEARCH

## SINGLE CONCERN

Prune and export research collected during Discovery for reuse by Research module.

---

## PURPOSE

Discovery collects substantial research during belief validation:
- Web searches and fetches
- Discourse items extracted
- Counter-evidence from kill queries

This step prunes irrelevant items and exports the rest in a format Research can optionally consume, avoiding duplicate API calls.

**Principle:** Export raw material, not validated conclusions. Research module decides how to use it.

---

## INPUT

| Input | Source |
|-------|--------|
| `discourse_items[]` | All items from step 2b |
| `web_fetch_results[]` | All fetch results from validation steps |
| `kill_query_results[]` | Counter-evidence from step 5 |
| `belief` | Final validated belief from 6c |
| `provisional_outline` | Slots from 6c |

---

## OUTPUT

### `RESEARCH_SO_FAR.yaml`

```yaml
research_so_far:
  generated_by: discovery
  belief: "The validated belief"

  sources:
    - id: RS_01
      url: "https://..."
      title: "Source title"
      fetched_at: "2026-01-19"
      credibility: high | medium | low
      fetch_status: success | failed | snippet_only

  discourse_items:
    - id: DI_01
      text: "Extracted fact or quote"
      source_ref: RS_01
      slot_relevance: [AP_01, AP_03]  # Which slots this supports
      type: fact | quote | statistic | anecdote

  counter_evidence:
    - query: "networking doesn't help careers"
      sources_checked: 3
      result: no_strong_invalidators | invalidator_found
      notes: "Optional context"

  meta:
    total_searches: 14
    total_fetches: 5
    items_before_prune: 21
    items_after_prune: 12
    prune_reason_counts:
      kept: 12
      killed_candidate: 5
      no_slot_match: 3
      redundant: 1
```

---

## PRUNING PROCESS

### Step 1: Match Items to Slots

For each discourse item:
1. Check if it supports ANY slot in `provisional_outline`
2. Record which slots it matches in `slot_relevance`
3. Items matching zero slots → candidate for pruning

### Step 2: Filter by Belief Relevance

| Item Status | Action |
|-------------|--------|
| Supports final belief + matches slot | **KEEP** |
| Supports final belief + no slot match | **DISCARD** (no_slot_match) |
| Supported killed candidate only | **DISCARD** (killed_candidate) |
| Counter-evidence (any) | **KEEP** (informational) |

### Step 3: Deduplicate

For items covering the same claim:
1. Keep the strongest (better sourced, more specific)
2. Discard redundant items
3. Record in `prune_reason_counts.redundant`

### Step 4: Export Sources

For each kept item:
1. Include its source in `sources[]`
2. Record fetch status and credibility
3. Deduplicate sources (same URL → one entry)

---

## SLOT MATCHING RULES

An item matches a slot when:

| Condition | Match? |
|-----------|--------|
| Item directly addresses slot description | YES |
| Item provides evidence slot would need | YES |
| Item tangentially related | NO |
| Item about different aspect of topic | NO |

**Be conservative.** When in doubt, don't claim a match.

```yaml
# Example: Slot "Job mobility statistics since 2000"

# MATCHES:
- "Average job tenure dropped from 12 years to 8 years between 2000-2020"
- "35% of workers under 35 have changed jobs in the past 2 years"

# DOES NOT MATCH:
- "Japanese companies value loyalty" (no statistics)
- "Lifetime employment began post-WWII" (historical, not mobility stats)
```

---

## CREDIBILITY INHERITANCE

Discovery may have assessed source credibility. Export it, but note:

```yaml
sources:
  - id: RS_01
    credibility: medium  # Discovery's assessment
    # Research module may re-evaluate
```

**Research is NOT required to trust these ratings.** They're hints, not verdicts.

---

## COUNTER-EVIDENCE EXPORT

Export counter-evidence searches for informational context:

```yaml
counter_evidence:
  - query: "lifetime employment still exists Japan"
    sources_checked: 4
    result: no_strong_invalidators
    notes: "Found some large companies still practice it, but declining"
```

**Research module is NOT required to skip queries based on this.** Different consumers have different rigor requirements.

---

## META TRACKING

Track pruning statistics for debugging:

```yaml
meta:
  total_searches: 14      # WebSearch calls during Discovery
  total_fetches: 5        # web_fetch calls during Discovery
  items_before_prune: 21  # Discourse items before filtering
  items_after_prune: 12   # Items in final export
  prune_reason_counts:
    kept: 12
    killed_candidate: 5   # Supported belief that was killed
    no_slot_match: 3      # Didn't match any slot
    redundant: 1          # Duplicate of stronger item
```

---

## HARD CONSTRAINTS

- Only export items that match at least one slot
- Do NOT export items that only supported killed candidates
- Keep all counter-evidence (even if belief was killed)
- Deduplicate before export
- Record prune reasons in meta
- Do NOT interpret or validate items - export raw material

---

## COMPLETION RULE

Done when:
- All discourse items evaluated against slots
- Matching items exported with slot_relevance
- Non-matching items pruned with reasons logged
- Sources deduplicated and exported
- Counter-evidence exported
- Meta statistics recorded
- RESEARCH_SO_FAR.yaml written

---

## INTEGRATION

This is the FINAL step of Discovery (after 6c).

**Output goes to:** Research module (optional input)

**If Research doesn't use it:** No impact. RESEARCH_SO_FAR.yaml is additive output.

---

## NEXT STEP

Discovery complete. Outputs:
- `DISCOVERY_RESULT.yaml` (from 6c) - required by Research
- `RESEARCH_SO_FAR.yaml` (from 6d) - optional for Research
