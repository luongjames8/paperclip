# DESCRIPTION GENERATION (Step 3 of Packaging Module)

## PURPOSE

Generate a YouTube description optimized for SEO, viewer utility, and engagement.

---

## INPUTS

| Input | Source | Purpose |
|-------|--------|---------|
| `ANGLE_LOCK.yaml` | Firm angle lock | Locked title, thumbnail concept, core promise |
| `TITLE_VARIATIONS.yaml` | Step 1 output | Title phrasing variations for alignment |
| `POLISH_COMPLETE.md` | Polish phase | Key points and context |

---

## DESCRIPTION ANATOMY

A YouTube description has distinct zones with different purposes:

```
┌─────────────────────────────────────────┐
│ HOOK LINE (first 100-150 chars)         │ ← Visible in search/browse
│ Shows before "...more"                  │
├─────────────────────────────────────────┤
│ CONTEXT (2-3 sentences)                 │ ← What this video delivers
│ Expands on the hook                     │
├─────────────────────────────────────────┤
│ CHAPTERS                                │ ← Timestamps for navigation
│ 0:00 Intro                              │
│ 1:23 Section name                       │
├─────────────────────────────────────────┤
│ CTA BLOCK                               │ ← Subscribe, related content
│ Subscribe, bell, playlist links         │
├─────────────────────────────────────────┤
│ LINKS                                   │ ← Sources, social, credits
│ Sources, social media, etc.             │
├─────────────────────────────────────────┤
│ KEYWORDS / HASHTAGS                     │ ← SEO (3-5 hashtags max)
│ #topic #keyword #niche                  │
└─────────────────────────────────────────┘
```

---

## PROMPT

```
You are a YouTube SEO specialist. Your job is to write a description that maximizes discoverability while providing genuine value to viewers.

Read the inputs below and generate a complete YouTube description.

## Zone-by-Zone Instructions

### 1. HOOK LINE (Critical)
- First 100-150 characters are visible before "...more"
- Must create curiosity or promise value
- Should align with the title but NOT repeat it verbatim
- Use the core tension or revelation from the angle

### 2. CONTEXT
- 2-3 sentences expanding on what the video delivers
- Include the primary keyword naturally
- Set expectations: what will viewers learn/feel?

### 3. CHAPTERS
- Use the video_overview sections to create timestamps
- Format: `0:00 Section name`
- Keep chapter names concise (2-5 words)
- First chapter should be "Intro" or the hook section name

### 4. CTA BLOCK
- Subscribe reminder (brief, not pushy)
- Mention notifications if relevant
- Link to related playlist if applicable
- Keep to 2-3 lines max

### 5. LINKS
- Placeholder for sources: `[SOURCES TO BE ADDED]`
- Social media placeholders: `[SOCIAL LINKS]`
- Keep organized and scannable

### 6. KEYWORDS / HASHTAGS
- 3-5 hashtags maximum (YouTube penalizes hashtag spam)
- First 3 hashtags appear above title on video page
- Use: #[primary topic] #[niche] #[content type]
- No spaces in hashtags

## Output Format

Provide your description in this exact YAML structure:

```yaml
description:
  hook_line: "[First 100-150 chars - visible in search]"

  full_text: |
    [Hook line]

    [Context paragraph - 2-3 sentences]

    ⏱️ CHAPTERS
    0:00 [Chapter 1]
    [X:XX] [Chapter 2]
    [X:XX] [Chapter 3]
    ...

    🔔 [CTA - subscribe/notifications]

    📚 SOURCES
    [SOURCES TO BE ADDED]

    🔗 CONNECT
    [SOCIAL LINKS]

    #hashtag1 #hashtag2 #hashtag3

  seo_notes:
    primary_keyword: "[main keyword targeted]"
    secondary_keywords: ["keyword2", "keyword3"]
    hashtags: ["#tag1", "#tag2", "#tag3"]

  character_count: [total chars in full_text]
```

## Important

- YouTube descriptions can be up to 5000 characters, but keep it focused
- Front-load important info (hook, context, chapters)
- Chapters require at least 3 timestamps and minimum 10 seconds between each
- First 3 hashtags appear above video title - choose wisely
- Don't keyword-stuff - YouTube detects and penalizes this
```

---

## OUTPUT

Write to `YOUTUBE_DESCRIPTION.md`:

```yaml
description:
  hook_line: "[visible preview text]"

  full_text: |
    [Complete description with all zones]

  seo_notes:
    primary_keyword: "[keyword]"
    secondary_keywords: []
    hashtags: []

  character_count: [N]
```

---

## EXECUTION OPTIONS

| Model | When to Use |
|-------|-------------|
| **Claude (Opus) (Recommended)** | Default choice — significantly better hook and context quality |
| DeepSeek (via MCP) | Only for drafts or when cost is primary concern |

> **Tested (RUN_20260119_1026)**: Opus significantly outperformed DeepSeek:
> - Hook: Opus 92 chars (perfect) vs DeepSeek 178 chars (truncated in search)
> - Stat: Opus included "262,000" stat, DeepSeek omitted
> - SEO: Opus added search_intent + title_alignment fields
> Use Opus for production descriptions.

---

## TIPS

- If the hook line is weak, ask: "Make the hook more curiosity-driven" or "Lead with the surprising stat"
- If chapters are too generic, ask: "Make chapter names more specific to the content"
- Review hashtag choices - first 3 appear prominently, make them count
- The description should complement the title, not repeat it

---

## ECOSYSTEM CONSISTENCY GATE

After generating the description, run this validation before finalizing. This catches metadata drift — where the title targets one ecosystem but the description/tags accidentally signal a competing one.

### Why This Exists
A video titled "Why German Engineering is Failing" with a description full of "automotive engineering," "car manufacturing," and "vehicle production" will route to car review audiences instead of brand-documentary audiences. Every keyword in your metadata is a signal to YouTube's classifier. They must all point to the SAME ecosystem.

### Process

1. **Load context**: Read `target_ecosystem` from `ANGLE_LOCK.yaml`

2. **Scan all metadata entities**:
   - **Title keywords**: Extract all meaningful words/phrases from the locked title
   - **Description entities**: Extract all nouns, brand names, industry terms, and technical phrases from `full_text`
   - **Hashtags**: All hashtags from `seo_notes.hashtags`
   - **Secondary keywords**: All terms from `seo_notes.secondary_keywords`

3. **Cross-ecosystem check**: For each extracted entity, assess:
   - Does this term have HIGH signal density in a competing ecosystem?
   - Example: `target_ecosystem: "brand-decline documentary"` but description contains:
     - "automotive engineering" → HIGH signal in automotive/car review ecosystem ⚠️
     - "car manufacturing" → HIGH signal in automotive ecosystem ⚠️
     - "vehicle production" → HIGH signal in automotive ecosystem ⚠️
     - "corporate strategy" → ALIGNED with brand-documentary ecosystem ✓
     - "market share decline" → ALIGNED with brand-documentary ecosystem ✓

4. **Entity-to-ecosystem coherence**: Verify all metadata points to the SAME ecosystem:
   - If title says "Sony" but description is full of "BMW, Mercedes, automotive" → **FAIL**
   - If title says "Netflix" but hashtags are "#streaming #movies #Hollywood" (entertainment review ecosystem) instead of "#business #strategy #techcompany" → **FLAG**
   - All entities across title, description, tags, and hashtags must reinforce ONE ecosystem

5. **Verdict**:
   - **PASS**: All metadata entities align with `target_ecosystem`, no competing ecosystem signals detected
   - **AMBER**: 1-2 borderline terms that COULD signal a competing ecosystem — flag for human review
   - **FAIL**: 3+ terms with high signal density in a competing ecosystem, OR title and description point to clearly different ecosystems

### Output

Append to `YOUTUBE_DESCRIPTION.md`:

```yaml
ecosystem_gate:
  target_ecosystem: "[from ANGLE_LOCK.yaml]"
  verdict: "PASS|AMBER|FAIL"
  scanned_entities:
    title_keywords: ["keyword1", "keyword2"]
    description_entities: ["entity1", "entity2", "entity3"]
    hashtags: ["#tag1", "#tag2"]
    secondary_keywords: ["kw1", "kw2"]
  flagged_terms:
    - term: "[problematic term]"
      competing_ecosystem: "[which ecosystem it signals]"
      location: "title|description|hashtag|secondary_keyword"
      suggestion: "[replacement term that stays in target ecosystem]"
  coherence_check:
    title_ecosystem: "[what ecosystem the title signals]"
    description_ecosystem: "[what ecosystem the description signals]"
    hashtag_ecosystem: "[what ecosystem the hashtags signal]"
    all_aligned: true|false
```

### If FAIL
- Do NOT finalize the description
- Rewrite flagged terms using ecosystem-appropriate alternatives
- Re-run the gate until PASS or AMBER
- If AMBER, present flagged terms to human for final call
