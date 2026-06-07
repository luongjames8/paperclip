# 2d: EVALUATE NOVELTY

## SINGLE CONCERN

Determine if found beliefs are interesting or just predictable search results.

---

## INPUT

| Input | Source |
|-------|--------|
| `topic` | Original topic |
| `found_beliefs[]` | From step 2c |
| `iteration` | Current loop iteration |

---

## OUTPUT

```yaml
novelty_evaluation:
  overall_novelty: LOW | MEDIUM | HIGH
  interesting_count: 2
  predictable_count: 3

  beliefs_evaluated:
    - belief: "Japanese workers are overworked"
      novelty: PREDICTABLE
      reason: "First page of any Google search about Japan work"

    - belief: "Young Japanese workers job-hop frequently now"
      novelty: INTERESTING
      reason: "Counter-narrative to dominant stereotype, not obvious"

    - belief: "Japanese overtime is often performative, not productive"
      novelty: INTERESTING
      reason: "Nuances the overwork narrative in unexpected way"

    - belief: "Japanese companies are hierarchical"
      novelty: PREDICTABLE
      reason: "Standard business school talking point"

  recommendation: CONTINUE | STOP
  continue_reason: "Found 2 interesting beliefs, but might find more with refined queries"
  # OR
  stop_reason: "3 interesting beliefs found, sufficient novelty for fusion"

  refinement_hints:  # If CONTINUE
    - "Dig deeper into generational differences"
    - "Look for counter-examples to hierarchy narrative"
    - "Search for recent workplace reforms"

  pivot_candidates:  # If any INTERESTING belief is sharper than original topic
    - belief: "Japanese workers pay strangers to quit for them"
      why_sharper: "Specific, bizarre, immediate hook vs broad analytical frame"
    - belief: "7% like their company but 70% stay anyway"
      why_sharper: "Paradox with tension, not just a trend description"

  required_candidates:  # Beliefs that MUST survive to final decision (BINDING)
    - belief: "97% of servers prefer tipping"
      why_required: "INTERESTING + specific numeric - cannot be absorbed into generic frame"
    - belief: "Servers earn $35-50/hr under tipping"
      why_required: "INTERESTING + counterintuitive (challenges 'servers are underpaid' assumption)"
```

---

## PROCESS

### Evaluate each belief

For each found belief, ask:

| Question | If YES → | If NO → |
|----------|----------|---------|
| Would this appear on first page of Google? | PREDICTABLE | Possibly interesting |
| Is this a common stereotype/cliché? | PREDICTABLE | Possibly interesting |
| Does this surprise or challenge expectations? | INTERESTING | Possibly predictable |
| Does this add nuance to known narrative? | INTERESTING | Possibly predictable |
| Is this specific vs generic? | More interesting | More predictable |

### Novelty criteria

| Rating | Meaning |
|--------|---------|
| PREDICTABLE | AI could have guessed this, obvious search result |
| INTERESTING | Unexpected, counter-narrative, adds real value |

### Overall assessment

| overall_novelty | Criteria |
|-----------------|----------|
| HIGH | 3+ INTERESTING beliefs |
| MEDIUM | 1-2 INTERESTING beliefs |
| LOW | 0 INTERESTING (all predictable) |

### Recommendation logic

| Condition | Recommendation |
|-----------|----------------|
| HIGH novelty | STOP - sufficient interesting material |
| MEDIUM novelty + iteration < 3 | CONTINUE - might find more |
| MEDIUM novelty + iteration >= 3 | STOP - diminishing returns |
| LOW novelty + iteration < 3 | CONTINUE - need to dig deeper |
| LOW novelty + iteration >= 3 | STOP - topic may not have interesting angles |

### Refinement hints

If recommending CONTINUE, suggest:
- What direction to explore
- What counter-narratives to search for
- What niches might yield better results

### Pivot candidates

If any INTERESTING belief is sharper than the original topic framing, flag it:

| Sharper means | Example |
|---------------|---------|
| More specific | "proxy resignation industry" vs "changing work culture" |
| Has a hook | "pay someone to quit" vs "attitudes are shifting" |
| Contains tension | "hate company but stay" vs "loyalty declining" |
| Counterintuitive | Surprises on first read |

Output these as `pivot_candidates` so orchestrator can consider switching focus.

### Flag required candidates (BINDING)

If a belief is INTERESTING AND any of:
- Contains specific numbers/percentages
- Reverses common moral intuition
- Creates "wait, what?" reaction
- Is sharper than the original topic frame

→ Add to `required_candidates[]` with `why_required`

These beliefs MUST reach 4d as standalone candidates. They cannot be:
- Absorbed into generic frames (protected in 3a)
- Merged away during fusion
- Vetoed in 4d (unless KILLED in 5c)

| Trigger | Example | Why Required |
|---------|---------|--------------|
| Specific numeric | "97% of servers prefer tipping" | Data point IS the interesting finding |
| Counterintuitive | "Servers earn $35-50/hr" | Challenges assumptions directly |
| Paradox | "7% like company but 70% stay" | Tension creates content potential |
| Reverses frame | "Tipping helps servers, not hurts them" | Flips the expected narrative |

---

## HARD CONSTRAINTS

- Evaluate novelty ONLY (do not validate bonafide or classify)
- Be honest about predictability (most first-pass results are predictable)
- Provide actionable refinement hints if continuing
- Maximum 3 iterations (prevent infinite loops)
- **If INTERESTING beliefs exist, at least ONE must be flagged as required_candidate**
- **STOP is invalid if all surviving beliefs are PREDICTABLE and iteration < 3** (dig deeper for surprises)

---

## COMPLETION RULE

Done when:
- Each belief evaluated for novelty
- Overall assessment made
- Clear recommendation with reasoning
- If CONTINUE: refinement hints provided
- If INTERESTING beliefs found: at least one added to `required_candidates`

---

## NEXT STEP

If STOP: `found_beliefs[]` → `steps/3a_match_beliefs.md`

If CONTINUE: `refinement_hints` → `steps/2a_generate_queries.md` (loop back)
