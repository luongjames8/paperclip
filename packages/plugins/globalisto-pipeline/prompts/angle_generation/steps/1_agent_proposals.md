# STEP 1: AGENT ANGLE PROPOSALS

## PURPOSE
Generate 3 independent content angle proposals using heterogeneous agents with different creative lenses. Each agent sees the same inputs but approaches from a different perspective.

## INPUT
| Input | Source |
|-------|--------|
| `DISCOVERY_COMPLETE.yaml` | From Discovery phase |
| `COMPETITOR_SCAN.yaml` | From Step 0 |

## PROCESS

Dispatch 3 agents IN PARALLEL. Each agent produces one ANGLE_PROPOSAL file. Agents must NOT see each other's output (independent judgment).

### CRITICAL: THE HEADLINE TEST (ALL AGENTS)

Before ANY agent writes a proposal, it must pass this test:

**"If this topic were breaking news on CNN right now, what would the chyron say?"**

That chyron IS your title. Not a clever reframe. Not an obscure detail from research. The OBVIOUS, EMOTIONAL, PLAIN-ENGLISH headline that would make a normal person say "wait, WHAT?"

Examples of what this produces:
- Antimony → "America Can't Make Its Own Bullets Anymore" (NOT "The Pentagon's $245M Bluff")
- Boeing → "Boeing's Last Safe Plane Was Designed in 1995" (NOT "The MCAS Override Paradox")
- Samsung → "Samsung Won By Copying For 50 Years. Then Nobody Was Left To Copy." (NOT "HBM3 Yield Culture Dynamics")

**The agents' job is to find the SIMPLEST, MOST ALARMING framing of the CORE story — then differentiate through format (mystery/paradox/anxiety), NOT through obscure sub-topics.**

Three agents should propose THREE DIFFERENT FORMATS of the SAME core story, not three different sub-topics. The differentiation is HOW you frame it, not WHAT obscure detail you found.

---

### Agent A: YouTube Strategist (Opus)
**Model:** claude-opus-4-6 via main context
**Lens:** Maximize click-through rate and audience growth. Think about what title would stop a casual browser from scrolling. Prioritize curiosity gaps, recognizable names (T1/T2), and proven title patterns.

**System prompt for Agent A:**
> You are a YouTube Strategist optimizing for CTR and audience growth.
>
> Given the discovery material and competitor scan below, propose ONE content angle.
>
> IMPORTANT: Start with the CORE STORY — the single most alarming, simple truth about this topic that a normal person would react to. Then package it using a Tier 1 title format (mystery/paradox/anxiety/david_vs_goliath/secret). Do NOT optimize for novelty by choosing an obscure sub-topic. The viewer clicks on the BIG story, not the clever detail.
>
> Your angle must include:
> - title (5-8 words, must contain T1/T2 recognizable name, MUST use Tier 1 format)
> - core_story (the CNN chyron version — what is the SIMPLE alarming truth?)
> - one_sentence_promise (what the viewer gets)
> - thumbnail_concept (visual that complements, not repeats, the title)
> - target_ecosystem (which YouTube channels/audience this competes with)
> - opening_hook (first line that confirms the title's promise)
> - reasoning (why this angle wins against competitors)
> - angle_type (e.g., "expose", "explanation", "prediction", "story")
> - discourse_refs (beliefs/items from DISCOVERY_COMPLETE that support this angle)
>
> AVOID: Saturated angles from COMPETITOR_SCAN. Differentiate through FORMAT, not through obscure sub-topics.

### Agent B: Documentary Filmmaker (GPT-4.1)
**Model:** GPT-4.1 via mcp__openai-agent (or the deepseek CLI `deepseek chat` if unavailable)
**Lens:** Narrative and emotional arc. Think about what story structure makes this compelling. Prioritize human drama, stakes, turning points, and visual storytelling.

**System prompt for Agent B:**
> You are a Documentary Filmmaker focused on narrative and emotional impact.
>
> Given the discovery material and competitor scan below, propose ONE content angle.
>
> IMPORTANT: Start with the CORE STORY — the single most alarming, simple truth about this topic. Then find the HUMAN STORY within it (who suffered? who made the decision? what moment changed everything?). Package using a Tier 1 title format. Do NOT choose an obscure sub-topic because it's "more original." The viewer needs to understand the stakes from the title alone.
>
> Your angle must include all fields listed above, plus core_story.
>
> Focus on: human stakes, narrative tension, visual moments, emotional arc.
> AVOID: Dry analysis, listicle structures, saturated angles from COMPETITOR_SCAN. Differentiate through FORMAT and NARRATIVE LENS, not through obscure sub-topics.

### Agent C: Adversarial Journalist (DeepSeek-Reasoner)
**Model:** DeepSeek reasoning via the deepseek CLI (`deepseek chat --thinking true`)
**Lens:** Contrarian challenge. What's the uncomfortable truth everyone is avoiding? What's the counterintuitive take that would make viewers say "wait, really?"

**System prompt for Agent C:**
> You are an Adversarial Journalist seeking uncomfortable truths.
>
> Given the discovery material and competitor scan below, propose ONE content angle.
>
> IMPORTANT: Start with the CORE STORY — the single most alarming, simple truth. Then find the UNCOMFORTABLE ANGLE the other two agents might soften or avoid. Who is to blame? What decision caused this? What are they still lying about? Package using a Tier 1 title format. The contrarian take should be on the CORE story, not on an unrelated sub-topic.
>
> Your angle must include all fields listed above, plus core_story.
>
> Focus on: contrarian takes, overlooked evidence, counterintuitive conclusions about the MAIN story.
> AVOID: Clickbait without substance, conspiracy thinking, saturated angles. Differentiate through PERSPECTIVE on the core story, not through obscure sub-topics.

## OUTPUT
### `ANGLE_PROPOSAL_A.yaml` (from YouTube Strategist)
### `ANGLE_PROPOSAL_B.yaml` (from Documentary Filmmaker)
### `ANGLE_PROPOSAL_C.yaml` (from Adversarial Journalist)

Each file follows this schema:
```yaml
agent: "youtube_strategist" | "documentary_filmmaker" | "adversarial_journalist"
model: "[model used]"
title: "[5-8 words]"
one_sentence_promise: "[what viewer gets]"
thumbnail_concept: "[visual description]"
target_ecosystem: "[channels/audience]"
opening_hook: "[first line of video]"
reasoning: "[why this angle works, referencing competitor gaps]"
angle_type: "[expose|explanation|prediction|story|challenge|reveal]"
discourse_refs:
  - "[B_XX or item reference from discovery]"
```

## WHAT WE KNOW WORKS (HARD DATA)

Every agent MUST internalize these findings before proposing. These are not suggestions — they are empirically validated from our channel's performance data.

### Brand Name in Title Is Non-Negotiable

| Video | Brand Recognition | Views |
|-------|-------------------|-------|
| "How Sony Destroyed Itself" | T1 (universal) | 117,000 |
| "German Engineering" | No brand | 92 |
| "Wall Street CEOs" | No brand | 92 |
| McKinsey topic | T3 (obscure) | Failed |

**Pattern:** Every flop lacked a universally recognized brand name. Sony is a household name worldwide. McKinsey is known only to business insiders. "German Engineering" is a concept, not a brand. The title MUST contain a brand your mom would recognize (Apple, Nike, Toyota, Samsung, Disney, Netflix, etc.).

### Ecosystem Density Determines Distribution

YouTube places your video into an existing viewing ecosystem based on title keywords. If no ecosystem exists, your video has nowhere to go.

- **Sony worked** because East Money, Business Insider, Logically Answered, and dozens of other channels had already built a "brand decline documentary" ecosystem. YouTube knew exactly where to place it.
- **"German Engineering" died** because those keywords route to automotive/car-review content (BMW reviews, Mercedes comparisons). Zero documentary ecosystem.
- **Before proposing any angle**, mentally search the title on YouTube. If the top 10 results are from your target genre → green light. If they're from a different genre → the title is misrouted.

### CTR Thresholds (Algorithm Behavior)

- **4%+ CTR** in test phase (~3,500 impressions) → algorithm triggers scale-up
- **2%+ CTR** at scale (200K impressions/day) → sustains distribution
- **Below 2%** → death. Algorithm kills the video.
- Title must convert COLD Browse traffic — people on their home page who've never seen our channel. This is NOT suggested-video traffic from subscribers.

### Browse Features Triggers First

Sony was pushed to home pages on day 4, not through suggested videos. The algorithm tested it on Browse Features (home feed) against cold audiences. This means:
- Title must be compelling to someone who has ZERO context about our channel
- No inside references, no sequel assumptions, no niche jargon
- The title competes against MrBeast, Veritasium, and whatever else is on that person's home page

### Provocation Works (When Content Is Balanced)

Sony comment analysis shows audiences came for **brand loyalty and nostalgia**, not business education. "How Sony Destroyed Itself" provoked brand fans into rage-clicking to disagree. The content was balanced and fair — the title was provocative.

- **Mechanism:** Brand fans see the title → emotional reaction ("No they didn't!") → click to argue → watch to find counterpoints → comment → engagement signal → algorithm pushes harder
- **Key:** Content must be balanced. Provocative title + one-sided content = dislike bomb. Provocative title + nuanced content = high engagement.

### Title Determines Ecosystem Placement

"German Engineering" → routed to automotive cluster. "Sony" → routed to brand-decline documentary cluster. Title keywords are the ONLY signal YouTube has for routing a new channel's video. There is no channel authority, no subscriber signal, no historical data to rely on. **The title IS the routing instruction.**

### SERP Audit Is Mandatory

Before finalizing any title, perform this 60-second test:
1. Search the exact proposed title on YouTube (incognito)
2. Check top 10 results
3. If 7+ results are from your target ecosystem → green light
4. If <5 → title keywords are misrouted → swap the offending words and re-test
5. Type first 3-5 words into YouTube search bar — autocomplete reveals the semantic neighborhood

---

## AGENT-LEVEL REQUIREMENTS (ALL 3 AGENTS)

In addition to the fields listed in each agent's section above, EVERY proposal MUST include:

1. **Title MUST contain a T1 universally recognized brand name.** T1 = your mom would know it. Apple, Sony, Nike, Toyota, Samsung, Disney, Netflix, McDonald's, Coca-Cola, Google, Amazon, Boeing, NASA. NOT: McKinsey, Palantir, Broadcom, Danaher.

2. **`target_ecosystem` field** — Name the specific YouTube viewing ecosystem this video enters. Not "business" — specific: "brand-decline documentaries (Company Man, ColdFusion, Logically Answered)" or "tech giant analysis (TechAltar, Asianometry, PolyMatter)."

3. **`anchor_videos` field** — List 3 specific existing YouTube videos (title + channel) that the new video should appear "Suggested" beside. These must be real videos with substantial views. This forces the agent to prove the ecosystem exists.

```yaml
# Updated schema — all agents
agent: "youtube_strategist" | "documentary_filmmaker" | "adversarial_journalist"
model: "[model used]"
title: "[5-8 words, MUST contain T1 brand name, MUST use Tier 1 format]"
title_format: "mystery" | "paradox" | "anxiety" | "system_breakdown" | "david_vs_goliath" | "secret" | "provocation"
title_format_justification: "[which proven template this follows and why]"
one_sentence_promise: "[what viewer gets]"
thumbnail_concept: "[visual description]"
target_ecosystem: "[specific channels/audience cluster this enters]"
anchor_videos:
  - title: "[exact video title]"
    channel: "[channel name]"
    approx_views: "[view count]"
  - title: "[exact video title]"
    channel: "[channel name]"
    approx_views: "[view count]"
  - title: "[exact video title]"
    channel: "[channel name]"
    approx_views: "[view count]"
opening_hook: "[first line of video]"
reasoning: "[why this angle wins, referencing competitor gaps AND ecosystem fit]"
angle_type: "[expose|explanation|prediction|story|challenge|reveal]"
trend_timing: "[current news/search trend that makes this topic timely NOW, or 'evergreen' if not time-sensitive]"
comp_title_reference: "[specific outlier title from MagnatesMedia/HMW/East Money that this title is modeled after]"
discourse_refs:
  - "[B_XX or item reference from discovery]"
```

### TITLE FORMAT REQUIREMENTS (March 2026)

Every agent MUST select a title format from these proven outlier categories:

| Format | Multiplier | Template | When To Use |
|--------|-----------|----------|-------------|
| **mystery** | 3.1x | "We Don't Know [How/Why] [Brand]..." | When there's a genuinely unanswered question |
| **paradox** | 2.9x | "[Brand] [Did X]. [Opposite Happened]." | When the story contains a counterintuitive truth |
| **anxiety** | 2.1x | "Why Hasn't [Brand/System] [Failed]... Yet?" | When something SHOULD have collapsed but hasn't |
| **system_breakdown** | 2.0x | "The [Overdue] Collapse of [System]" | When a system is visibly cracking |
| **david_vs_goliath** | 7.0x | "How [Underdog] Is Crushing [Giant]'s Empire" | When a small player is beating a giant |
| **secret** | 4.2x | "The $[Number] [Secret/Cult]" | When there's hidden scale or hidden actors |
| **provocation** | 1.7x | "How [Brand] Destroyed Itself" | ONLY when paradox/mystery don't fit |

**BANNED:** "The Rise and Fall of [X]", "The Decline of [X]...What Happened?", "What Happened to [X]?" — these formats are EXHAUSTED (0 outliers in 6 months on Company Man).

Every agent MUST also fill `comp_title_reference` — cite the specific competitor outlier title this is modeled after. This forces data-driven title construction, not guessing.

## HARD CONSTRAINTS
- ALL 3 agents must run INDEPENDENTLY — no agent sees another's output
- Each title MUST be 5-8 words (validated by angle:title_length gate)
- Each title MUST contain at least one T1/T2 recognizable name
- Each proposal MUST reference the competitor scan to explain differentiation
- DO NOT synthesize or merge proposals — present raw independent output

## GATES AFTER
After all 3 proposals are written, these gates run on EACH proposal:
1. `angle:title_length` — title is 5-8 words (local, automatic)
2. `angle:serp_audit` — YouTube search validates ecosystem fit (delegated)
3. `angle:brand_recognition` — title has T1/T2 names (delegated)
4. `angle:preflight_checklist` — 5 binary viability questions (delegated)

If any proposal fails a gate, that proposal is revised and re-checked (max 2 retries per proposal).

## COMPLETION RULE
Done when: All 3 ANGLE_PROPOSAL files written AND all 4 gates pass for each.

## NEXT STEP
`ANGLE_PROPOSAL_A/B/C.yaml` → `steps/2_human_convergence.md`
