# STEP 2b: AUDIENCE PROXIMITY CHECK

## PURPOSE

Verify that every beat in the structure stays at the abstraction level the TITLE promises.

**The problem this prevents:** A title like "Samsung Copied For 50 Years" promises a story about a COMPANY copying PRODUCTS that CONSUMERS know. If the structure drifts into semiconductor bonding methods, JEDEC standards, and foundry yield rates, the viewer who clicked for the consumer story will leave.

Language leveling (in polish) fixes HOW you say technical things. This step fixes WHETHER you should say them at all. By the time polish runs, beats are frozen. This is the last chance to catch topic drift.

---

## INPUT

| Input | Source |
|-------|--------|
| `STEP2_selected_themes.yaml` | From Step 2 (theme_selection) |
| `ANGLE_LOCK.yaml` | The locked title and one_sentence_promise |

---

## THE TEST

For each selected item/beat, ask:

**"Would a viewer who clicked THIS TITLE expect to hear about THIS?"**

The title sets a CONTRACT with the viewer. It defines what domain, what abstraction level, and what emotional register they signed up for. Beats that honor the contract score high. Beats that break it score low.

**This is NOT a "consumer vs specialist" test.** Different titles set different contracts:

| Title | Contract | What's CORE | What DRIFTS |
|-------|----------|-------------|-------------|
| "Samsung Copied For 50 Years" | Consumer brand story | Copying Sony, Apple, phones | Chip bonding methods, JEDEC standards |
| "America Can't Make Its Own Bullets" | Military/geopolitical exposé | Antimony in primers, stockpile sell-off, IDIQ contracts | PET bottle leaching, flame retardant chemistry |
| "Boeing's Last Safe Plane Was 1995" | Safety/accountability | 777 engineering, MCAS, stock buybacks | Airflow dynamics, metallurgy specs |
| "Google Search Makes You Dumber" | Personal/systemic anxiety | Brighton study, health misinfo, daily use | PageRank algorithm, ad auction mechanics |

**The principle: the title defines the abstraction level. Every beat must stay within it or earn its way in through clear causal connection.**

Score each beat:

| Score | Meaning | Action |
|-------|---------|--------|
| **CORE** | Directly promised by the title. Within the contract. | Keep — this IS the video |
| **BRIDGE** | Not directly promised but causally connects to something in the contract | Keep — earns its place through clear connection |
| **SPECIALIST** | Within the topic but at a deeper abstraction level than the title signals | Flag — needs translation to the title's level, absorption into a BRIDGE beat, or removal |
| **DRIFT** | Outside the topic entirely — the title's contract doesn't lead here | Remove |

### How to Determine the Title's Abstraction Level

Read the title. Ask: **"What kind of person clicks this, and what do they expect to learn?"**

- If the title names a BRAND consumers know → the contract is at the consumer/cultural level
- If the title names a SYSTEM people interact with → the contract is at the systemic/policy level  
- If the title names a CRISIS people are affected by → the contract is at the stakes/consequences level
- If the title names a TECHNICAL failure → the contract allows specialist detail because the viewer OPTED IN

A viewer who clicks "Samsung Copied For 50 Years" opted into a brand story. A viewer who clicks "Why Samsung's Chips Keep Failing Nvidia's Tests" opted into a technical story. Same company, different contracts.

### Rules for SPECIALIST Beats

SPECIALIST beats are not automatically removed. They get one of three treatments:

1. **TRANSLATE:** Rewrite at the abstraction level the title's contract sets.
   - The target level depends on the title, not on a universal "keep it simple" rule.
   - For a consumer-contract title: translate to brand/product language
   - For a geopolitical-contract title: translate to power/consequence language
   - For a technical-contract title: specialist detail may already BE the right level

2. **ABSORB:** Merge into a BRIDGE beat as a supporting detail, not a standalone beat.
   - The specialist detail becomes evidence FOR a claim the viewer expects, not a claim in itself.

3. **CUT:** If it can't be translated or absorbed without distorting the story, remove it. 

**Hard rule:** No more than 20% of beats should be SPECIALIST after treatment. If more than 20% remain SPECIALIST, the structure has drifted from the title's contract.

---

## PROCESS

1. Read the title and one_sentence_promise from ANGLE_LOCK.yaml
2. For each selected theme and its items:
   - Score every beat (CORE / BRIDGE / SPECIALIST / DRIFT)
   - Apply treatment to SPECIALIST beats (translate / absorb / cut)
   - Remove DRIFT beats entirely
3. Calculate proximity score: (CORE + BRIDGE) / total beats
4. If proximity < 80%: FAIL — too much specialist content. Restructure.

---

## OUTPUT

Use the following delimiter format to separate the two output files:

```
--- FILE: STEP2_selected_themes.yaml ---
(updated STEP2_selected_themes.yaml content — same file, updated in place with audience_proximity scores, treatment notes for SPECIALIST beats, and DRIFT beats removed)
--- FILE: PROXIMITY_REPORT.yaml ---
PROXIMITY_REPORT:
  title: "[from ANGLE_LOCK]"
  total_beats: [count]
  scores:
    core: [count]
    bridge: [count]
    specialist: [count]
    drift: [count]
  proximity_score: [0.0-1.0]
  specialist_treatments:
    - beat_id: "[id]"
      original: "[original text]"
      treatment: "translate | absorb | cut"
      result: "[new text or 'removed' or 'merged into [beat_id]']"
  pass: true/false
```

---

## HARD CONSTRAINTS

- Do NOT add new beats — only score, translate, absorb, or cut existing ones
- Do NOT change the meaning of CORE or BRIDGE beats
- SPECIALIST treatments must preserve the essential INFORMATION while changing the ABSTRACTION LEVEL
- A translated beat should be understandable by someone who only knows the title
- This step does not touch emotional function, loops, or teases — only topic proximity

---

## COMPLETION RULE

Done when:
- Every beat scored
- All SPECIALIST beats treated (translate/absorb/cut)
- All DRIFT beats removed
- Proximity score ≥ 80%
- PROXIMITY_REPORT.yaml complete

---

## NEXT STEP

Updated `STEP2_selected_themes.yaml` → `steps/3_narrative_gap_analysis.md`
