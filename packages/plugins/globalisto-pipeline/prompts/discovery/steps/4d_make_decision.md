# 4d: MAKE DECISION

## SINGLE CONCERN

Apply decision matrix to determine GO/NO-GO for a belief candidate, prioritizing surprising discoveries over obvious predictions.

---

## INPUT

| Input | Source |
|-------|--------|
| `belief` | The candidate belief |
| `bonafide_score` | From step 4b |
| `recency` | From step 4b |
| `interest_score` | From step 4c |
| `source_path` | From step 3b |
| `novelty` | From step 2d (PREDICTABLE or INTERESTING) |

---

## OUTPUT

```yaml
belief: "Young Japanese workers job-hop frequently now"

decision: GO | NO-GO | PRIORITY

scores:
  bonafide: HIGH
  interest: HIGH
  recency: HOT
  source_path: bottom_up_only
  novelty: INTERESTING

decision_reason: |
  HIGH bonafide + HIGH interest + HOT recency + INTERESTING novelty = PRIORITY.
  This is an UNEXPECTED discovery that challenges the dominant stereotype.
  Bottom-up discovery with counter-narrative potential.

# If NO-GO:
rejection_type: "stale_strawman" | "nobody_cares" | "insufficient_evidence" | "too_obvious"
rejection_detail: "..."
```

---

## DECISION MATRIX

| bonafide | interest | Decision |
|----------|----------|----------|
| LOW | any | **NO-GO** ("stale strawman - no one holds this") |
| any | LOW | **NO-GO** ("nobody cares - no audience interest") |
| MEDIUM | MEDIUM | **GO** (proceed with validation complete) |
| MEDIUM | HIGH | **GO** |
| HIGH | MEDIUM | **GO** |
| HIGH | HIGH | **GO** → check for PRIORITY |

### PRIORITY Upgrade

A GO belief becomes PRIORITY if ANY of these conditions are met:

**Condition A (Hot + Surprising):**
- bonafide = HIGH
- interest = HIGH
- novelty = INTERESTING (from 2d)

**Condition B (Unexpected Discovery):**
- source_path = bottom_up_only
- bonafide = HIGH
- interest = MEDIUM or higher

**Condition C (Classic Hot Topic):**
- bonafide = HIGH
- interest = HIGH
- recency = HOT

**PRIORITY RANKING** (when multiple candidates qualify):

| Rank | Criteria | Why |
|------|----------|-----|
| 1 | bottom_up_only + INTERESTING | Most valuable - non-obvious discovery |
| 2 | intersection + INTERESTING | Validated surprise |
| 3 | bottom_up_only + PREDICTABLE | Unexpected but obvious angle |
| 4 | intersection + PREDICTABLE | Safe but potentially boring |
| 5 | top_down_only | Highest staleness risk, lowest priority |

---

## OBVIOUSNESS PENALTY

**CRITICAL:** Beliefs that are PREDICTABLE (could be guessed without research) should be deprioritized even if bonafide and interest are HIGH.

| Scenario | Treatment |
|----------|-----------|
| intersection + PREDICTABLE | GO (not PRIORITY) - validated but obvious |
| bottom_up_only + INTERESTING | PRIORITY - this is gold |
| HIGH bonafide + PREDICTABLE + intersection | Demote to GO unless no better candidates |

**Why this matters:** "Abolishing tipping would hurt servers" is HIGH bonafide + HIGH interest but PREDICTABLE - any LLM would guess this. "97% of servers prefer tipping" or "Gen Z 43% always tip vs 84% Boomers" are INTERESTING - they surprise and challenge assumptions.

---

## OBVIOUSNESS VETO (Hard Rule)

**This is a HARD GATE, not advisory.**

If ANY of these exist in the candidate pool:
- `bottom_up_only + INTERESTING`
- `intersection + INTERESTING`

Then these are **automatically NO-GO**:
- `intersection + PREDICTABLE` (even if HIGH bonafide + HIGH interest)
- `top_down_only + any`

| Veto Trigger | Affected Candidates | Result |
|--------------|---------------------|--------|
| Any INTERESTING candidate exists | All PREDICTABLE + intersection | NO-GO |
| Any INTERESTING candidate exists | All top_down_only | NO-GO |
| `required: true` flag from 3b | Cannot be NO-GO (protected) | Must evaluate on merits |
| `veto_predictable: true` flag from 3b | All PREDICTABLE beliefs | NO-GO |

**Veto output format:**
```yaml
decision: NO-GO
rejection_type: "too_obvious"
rejection_detail: "INTERESTING candidates exist - PREDICTABLE intersection cannot win"
vetoed_by:
  - belief: "97% of servers prefer tipping"
    source_path: bottom_up_only
    novelty: INTERESTING
```

**Why this veto exists:** The pipeline's purpose is finding SURPRISING beliefs for the CORE ANGLE. Predictable beliefs should not be the ANGLE of a video when surprising alternatives exist.

**HOWEVER — YOUTUBE VIDEO EXCEPTION (content_type = youtube_video or youtube_video_thematic):**

For YouTube video content, PREDICTABLE beliefs vetoed by the obviousness veto MUST still be preserved with a new decision status: **BACKBONE**.

```yaml
decision: BACKBONE
rejection_type: "too_obvious_for_angle"
backbone_role: "setup" | "escalation" | "context" | "stakes"
backbone_reason: "This belief is too obvious to be the video's ANGLE, but it is essential narrative setup that makes the INTERESTING beliefs land."
```

**Why:** YouTube documentaries need a narrative arc. The obvious facts ARE the story — they're what the viewer needs to understand before the surprising reveal hits. A video about the $245M IDIQ contract means NOTHING if the viewer doesn't first know:
- Every bullet needs antimony (SETUP)
- America makes zero (ESCALATION)
- The stockpile was sold off (BETRAYAL)
- China banned exports (CRISIS)

These are PREDICTABLE but ESSENTIAL. They are not the angle — they are the foundation the angle stands on.

**BACKBONE beliefs:**
- Do NOT proceed to kill queries (step 5a) — they're accepted as-is
- DO proceed directly to step 6 (content classification) with `content_role: backbone`
- Are available to the structure module as narrative building blocks
- Cannot be the video's TITLE or HOOK — that must come from PRIORITY/GO beliefs

**The veto still applies to the ANGLE decision:** PREDICTABLE beliefs cannot be the video's core angle when INTERESTING alternatives exist. But they are preserved as narrative infrastructure.

---

## REJECTION TYPES

| Type | Trigger | Meaning |
|------|---------|---------|
| `stale_strawman` | bonafide = LOW | No one sincerely holds this belief |
| `nobody_cares` | interest = LOW | Topic generates no engagement |
| `insufficient_evidence` | Very few items | Not enough data to validate |
| `too_obvious` | PREDICTABLE + intersection + better candidates exist | Belief is true but boring |

---

## SOURCE PATH + NOVELTY MATRIX

**source_path AND novelty BOTH affect decision rules:**

| source_path | novelty | Priority Level | Interpretation |
|-------------|---------|----------------|----------------|
| bottom_up_only | INTERESTING | **HIGHEST** | Unexpected discovery - pursue first |
| intersection | INTERESTING | HIGH | Validated surprise - strong candidate |
| bottom_up_only | PREDICTABLE | MEDIUM | Found but obvious - okay fallback |
| intersection | PREDICTABLE | MEDIUM-LOW | Safe but potentially boring |
| top_down_only | any | **LOWEST** | Predicted but not found - staleness risk |

---

## PROCESS

1. **Check bonafide gate**
   - LOW bonafide → automatic NO-GO

2. **Check interest gate**
   - LOW interest → automatic NO-GO

3. **Apply GO criteria**
   - MEDIUM/MEDIUM or higher → GO

4. **Check PRIORITY criteria (in order)**
   - Is it INTERESTING + bottom_up_only? → PRIORITY (rank 1)
   - Is it INTERESTING + intersection? → PRIORITY (rank 2)
   - Is it HOT + HIGH/HIGH but PREDICTABLE? → GO (not PRIORITY unless no better options)

5. **Compare against other candidates**
   - If this is PREDICTABLE but other candidates are INTERESTING → this gets deprioritized
   - If all candidates are PREDICTABLE → use recency as tiebreaker

6. **Apply obviousness veto (HARD GATE)**
   - Scan all candidates for INTERESTING beliefs (bottom_up_only or intersection)
   - If ANY INTERESTING candidates exist:
     - Any PREDICTABLE + intersection belief → **NO-GO** (rejection_type: "too_obvious")
     - Any top_down_only belief → **NO-GO** (rejection_type: "too_obvious")
   - Check for `veto_predictable: true` flags from 3b
   - Check for `required: true` flags - these CANNOT be vetoed
   - **This is NON-NEGOTIABLE** - predictable cannot beat surprising

7. **Document decision**
   - Clear reasoning including novelty assessment
   - If NO-GO: specific rejection type
   - If vetoed: include `vetoed_by` showing which INTERESTING belief triggered the veto

---

## HARD CONSTRAINTS

- Apply matrix rules exactly
- LOW bonafide = always NO-GO (no exceptions)
- LOW interest = always NO-GO (no exceptions)
- **OBVIOUSNESS VETO is mandatory** - if INTERESTING candidates exist, PREDICTABLE candidates CANNOT win
- `required: true` beliefs cannot be vetoed (only KILLED in 5c)
- Document rejection reason clearly
- Do not proceed with NO-GO beliefs

---

## COMPLETION RULE

Done when:
- All score inputs reviewed
- Decision matrix applied
- Decision assigned (GO / NO-GO / PRIORITY)
- Decision reason documented
- If NO-GO: rejection type and detail provided

---

## NEXT STEP

**If GO/PRIORITY:** Belief proceeds to → `steps/5a_generate_kill_queries.md`

**If NO-GO:** Belief is rejected, logged in debug output, does not continue.
