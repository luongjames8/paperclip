# STEP 1c: TITLE AUDIENCE LOOP (Generator-Verifier)

## PURPOSE

Refine titles from angle proposals through an adversarial audience-simulation loop. The GENERATOR (angle agent) proposes titles based on research. The VERIFIER (audience simulator) tests whether a real person would click — with ZERO knowledge of the research.

**Why this exists:** Research-contaminated titles kill videos. "Samsung's AI Chip Failure Was Inevitable" is a research summary, not a clickable title. "How Samsung Destroyed Itself" is what people actually click. The generator can't see this blind spot because it's optimized for research accuracy. The verifier catches it.

---

## INPUT

| Input | Source |
|-------|--------|
| `ANGLE_PROPOSAL_A.yaml` | From Step 1 |
| `ANGLE_PROPOSAL_B.yaml` | From Step 1 |
| `ANGLE_PROPOSAL_C.yaml` | From Step 1 |

---

## PROCESS

For EACH proposal (A, B, C), run this loop:

### VERIFIER AGENT (Audience Simulator)

The verifier has access to ONLY:
- The proposed title
- The channel's proven success formula (below)
- The cold Browse viewer persona (below)

The verifier does NOT see:
- Discovery outputs
- Research data
- The angle description
- The reasoning

This isolation is critical. It prevents research vocabulary from leaking into the title evaluation.

### VERIFIER PROMPT

```
You are a YouTube audience simulator. You represent a casual viewer scrolling their YouTube home page at 11pm. You've never heard of this channel. You see this title among 20 others.

TITLE: "{title}"

Answer these 5 questions:

1. MOM TEST: Would your mother understand every word in this title? 
   If ANY word requires industry knowledge → FAIL
   Failing words: "HBM", "foundry", "semiconductor", "AI chip", "chaebol", "ecosystem", "paradigm", "infrastructure", "organizational culture"
   
2. SONY FORMULA TEST: Does this follow the proven pattern?
   Pattern: [Brand Everyone Knows] + [Provocative Verb/Claim About That Brand]
   "How Sony Destroyed Itself" ✅
   "Samsung's AI Chip Failure Was Inevitable" ❌ (jargon + academic framing)
   "How Samsung Is Destroying Itself" ✅
   
3. SCROLL-STOP TEST: Would you stop scrolling to click this?
   Competing against: "I Survived 100 Days...", "Why America Is Falling Behind", "$1 vs $1,000,000 Hotel"
   If the title doesn't create an IMMEDIATE emotional reaction → FAIL
   
4. RAGE-CLICK TEST: Would a fan of this brand click to DISAGREE?
   Sony proved that brand fans clicking to defend = massive engagement.
   If the title is neutral/academic, fans won't feel provoked → FAIL
   
5. ECOSYSTEM TEST: If you search this title on YouTube, would the results be brand-decline documentaries?
   Not phone reviews, not tech specs, not news clips.
   If title keywords route to wrong genre → FAIL

SCORE: Count PASS/FAIL. 
- 5/5 → PASS (title is ready)
- 3-4/5 → REWRITE (provide specific fix for each failure)
- 0-2/5 → REJECT (title needs complete rethinking)

If REWRITE or REJECT, rewrite using ONLY these proven formulas (in priority order):

**TIER 1 — Use first (producing outliers NOW, March 2026):**
- "We (Still) Don't Know [How/Why] [Brand] [Shocking Thing]..." (Mystery — 3.1x proven)
- "[Brand] [Did X]. [Opposite Happened]." (Paradox — 2.9x proven)
- "Why Hasn't [Brand] [Collapsed/Failed/Died]... Yet?" (Anxiety — 2.1x proven)
- "How [Underdog] Is Crushing [Brand]'s Empire" (David vs Goliath — 7.0x proven)
- "The $[Big Number] [Secret/Cult/Scam]" (Secret — 4.2x proven)
- "[Brand] [Extreme action]. Then [Opposite]." (Paradox — e.g. "Kodak Died. Its Twin Survived Making Skincare.")

**TIER 2 — Only if Tier 1 doesn't fit:**
- "How [Brand] Destroyed Itself" (Provocation — Sony model)
- "[Brand] Made the Best [X]. It Didn't Matter." (Paradox + nostalgia)

**NEVER USE (exhausted as of 2026):**
- "The Rise and Fall of [Brand]"
- "The Decline of [X]...What Happened?"
- "What Happened to [Brand]?"

Do NOT invent new patterns. Do NOT add parenthetical subtitles. Do NOT reference specific products, technologies, or insider concepts. The title is about the BRAND or SYSTEM, not its products.
```

### LOOP EXECUTION

```
iteration = 0
max_iterations = 3

WHILE iteration < max_iterations:
    Run VERIFIER on current title
    IF score == PASS:
        BREAK — title is locked
    ELSE:
        Take verifier's rewrite suggestion
        Replace title in ANGLE_PROPOSAL
        iteration += 1

IF iteration == max_iterations AND still not PASS:
    Flag for human review
    Include all 3 iteration attempts
```

### IMPORTANT: Preserve the Angle

When the verifier rewrites a title, ONLY the title changes. The angle description, research refs, structural template, and content plan stay the same. The title is the packaging — the content is independent.

Example:
- **Before:** Title: "Samsung's AI Chip Failure Was Inevitable" / Angle: Culture made Samsung incapable of competing in AI
- **After:** Title: "How Samsung Is Destroying Itself" / Angle: Culture made Samsung incapable of competing in AI (unchanged)

---

## OUTPUT

Same files, updated in place:
- `ANGLE_PROPOSAL_A.yaml` (title refined)
- `ANGLE_PROPOSAL_B.yaml` (title refined)
- `ANGLE_PROPOSAL_C.yaml` (title refined)

Each file gets additional fields:

```yaml
# Added by title audience loop
title_refinement:
  original_title: "[what the agent originally proposed]"
  final_title: "[what survived the verifier]"
  iterations: 2
  verifier_scores:
    - iteration: 1
      score: "2/5"
      failures: ["mom_test", "scroll_stop", "rage_click"]
      rewrite_suggestion: "How Samsung Is Destroying Itself"
    - iteration: 2
      score: "5/5"
      failures: []
  status: "PASS" | "FLAGGED_FOR_HUMAN"
```

---

## PROVEN FORMULAS (for verifier reference)

### TIER 1: OUTLIER FORMATS (Use these FIRST — proven 2x-4x multipliers, March 2026 data)

These formats are producing outliers RIGHT NOW based on How Money Works, MagnatesMedia, and East Money recent performance:

| Format | Pattern | Example | Multiplier | Source |
|--------|---------|---------|-----------|--------|
| **Mystery** | "We (Still) Don't Know [How/Why] [Shocking Thing]..." | "We Don't Know How Epstein Got So Rich..." | 3.1x (HMW) | HMW Jan 2026 |
| **Paradox** | "If [X]... Why [Opposite]?" or "[X Did Y]. [Opposite Happened]." | "If Not Bubble... Why Bubble Shaped?" | 2.9x (HMW) | HMW Nov 2025 |
| **Anxiety** | "Why Hasn't [Bad Thing] Happened... Yet?" | "Why Hasn't The Economy Collapsed... Yet?" | 2.1x (HMW) | HMW Jan 2026 |
| **System Breakdown** | "The [Overdue] Collapse of [System]" or "[System] Is Full" | "The Gig Economy is Full" | 2.0x (HMW) | HMW Dec 2025 |
| **David vs Goliath** | "How [Underdog] Is Crushing [Giant]'s Empire" | "How this Chinese Startup is Crushing Dyson's Empire" | 7.0x (EM) | East Money Sep 2025 |
| **Secret/Cult** | "The $[Number] [Secret/Cult/Scam]" | "The $47 Billion Cult" | 4.2x (MM) | MagnatesMedia Mar 2025 |
| **INSANE Truth** | "The INSANE Truth About [Brand]" | "The INSANE Truth About OpenAI" | 2.4x (MM) | MagnatesMedia Aug 2025 |

### TIER 2: PROVEN BRAND PROVOCATION (Sony model — still valid but saturating)

| Pattern | Example | Why It Works |
|---------|---------|-------------|
| "How [Brand] Destroyed Itself" | Sony (117K views) | Brand fans rage-click |
| "[Brand] Made the Best [X]. It Didn't Matter." | BlackBerry reframe | Paradox + nostalgia |
| "[Brand] [Did Extreme Thing]. Then [Opposite]." | "Kodak Died. Its Twin Survived Making Skincare." | Mystery + paradox |

### TIER 3: EXHAUSTED FORMATS (AVOID unless no alternative)

These are producing ZERO outliers as of March 2026:

| Pattern | Example | Status |
|---------|---------|--------|
| "The Rise and Fall of [Brand]" | Company Man format | EXHAUSTED — 0 outliers in 6 months |
| "The Decline of [X]...What Happened?" | Company Man format | EXHAUSTED — max 2.0x, declining |
| "[Brand] - Why They're Successful" | Company Man format | FLAT — no breakouts |
| "What Happened to [Brand]?" | Generic | OVERSATURATED |

**RULE: If the verifier rewrites a title, it MUST use a Tier 1 format first. Tier 2 only if Tier 1 genuinely doesn't fit. NEVER rewrite into Tier 3.**

### COMP TITLE TEMPLATES (from SocialBlade data, March 2026)

**MagnatesMedia outlier power words:** "secret" (15x), "everything" (12x), "billionaire" (12x), "evil" (12x), "insane" (5x), "disturbing" (5x), "world" (15x)

**How Money Works outlier power words:** "collapse" (4x), "overdue" (4x), "nobody" (2x), "anymore" (2x)

**East Money outlier power words:** "crushing" (4x), "built" (6x), "underdog" (2x), "quietly" (2x)

When rewriting, incorporate these power words where natural.

Anti-patterns that ALWAYS fail:
| Anti-Pattern | Example | Why It Fails |
|-------------|---------|-------------|
| Jargon title | "Samsung's HBM Yield Crisis" | Mom doesn't know HBM |
| Colon title | "Samsung: AI Paradox" | Academic, low CTR |
| Abstract concept | "The Cultural Time Bomb" | No brand, no provocation |
| Insider language | "Foundry Wars: Samsung vs TSMC" | Niche audience only |
| Neutral framing | "Samsung's Semiconductor Strategy" | No emotional trigger |
| Rise and Fall (2026) | "The Rise and Fall of X" | Exhausted format, 0 outliers |

---

## HARD CONSTRAINTS

- Verifier MUST NOT have access to discovery/research data
- Title changes MUST NOT alter the underlying angle/content plan
- Maximum 3 iterations per proposal
- If all 3 iterations fail → flag for human, do not force a pass
- Every title must still contain a T1 brand name after refinement

---

## GATE AFTER

`angle:audience_test` — Validates final title passes all 5 verifier checks

---

## NEXT STEP

Refined `ANGLE_PROPOSAL_A/B/C.yaml` → `steps/1b_serp_audit.md`
