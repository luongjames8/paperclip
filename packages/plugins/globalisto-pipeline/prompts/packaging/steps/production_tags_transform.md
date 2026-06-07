# PRODUCTION TAGS TRANSFORM (Step 6 of YouTube Module)

## PURPOSE

Transform data point and quote citations in the polished script into screen-ready production tags for video editors.

This step converts raw citations like `[dp_044]` into actionable tags like `[STAT ON SCREEN: "262K tech layoffs in 2023" — dp_044]`.

---

## INPUTS

| Input | Source |
|-------|--------|
| `POLISH_COMPLETE.md` | polish output (has 14 per-beat section headers) |
| `BEAT_GRAPH.yaml` | phase_5 output (contains production_sections for grouping) |
| `research_master.yaml` | phase_2 output (contains claims, quotes, and source URLs) |

---

## WHAT THIS STEP DOES

1. **Transform section structure** from per-beat (14 sections) to production sections (3-4 sections)
2. **Find all citations** in the polished script (`[dp_XXX]`, `[q_XXX]`)
3. **Look up each citation** in `research_master.yaml` to get the actual claim/quote text
4. **Generate screen-ready text** that fits on-screen constraints
5. **Insert production tags** before the relevant script text

---

## SECTION STRUCTURE TRANSFORMATION (CRITICAL)

The POLISH_COMPLETE.md arrives with **14 per-beat section headers** like:
```markdown
## SECTION 1: The Price Tag
...content...

## SECTION 2: The Headline You Saw
...content...
```

The PRODUCTION_SCRIPT.md must use **production_sections from BEAT_GRAPH.yaml** (3-4 sections):
```yaml
production_sections:
  - section_id: 1
    name: "HOOK"
    beats: ["BEAT_01", "BEAT_02"]
    timing: "0:00-0:30"
  - section_id: 2
    name: "BUILD"
    beats: ["BEAT_03", "BEAT_04", "BEAT_05"]
    ...
```

### Transformation Process

1. **Read production_sections** from BEAT_GRAPH.yaml
2. **Map sections to beats**: Each production_section lists which BEATs belong to it
3. **Map beats to content**: SECTION 1 in script = BEAT_01, SECTION 2 = BEAT_02, etc.
4. **Strip all `## SECTION X` headers** from the polished script
5. **Insert production_section headers** at the boundaries defined by production_sections
6. **Content flows continuously** within each production section (no internal section breaks)

### Example Transformation

**Input (14 per-beat sections):**
```markdown
## SECTION 1: The Price Tag
$14,810 per overdose death...

## SECTION 2: The Headline You Saw
You saw this headline in February 2021...
```

**Output (3-4 production sections):**
```markdown
## HOOK
[0:00-0:30]

$14,810 per overdose death...

You saw this headline in February 2021...

---

## BUILD
[0:30-3:30]

...content from BEAT_03, BEAT_04, BEAT_05 flows continuously...
```

**Key rules:**
- Strip ALL `## SECTION X: Name` headers from input
- Insert ONLY production_section headers (HOOK, BUILD, ESCALATE, LAND)
- Content from beats within a production section flows without internal breaks
- Add timing range under each production section header
5. **Shorten long quotes** and preserve full context for narrator

---

## TAG TYPES

| Tag | Purpose | Format |
|-----|---------|--------|
| `[STAT ON SCREEN: "text" — dp_XXX]` | Statistic or data point to display | Short, punchy number/fact |
| `[QUOTE CARD: "text" — q_XXX]` | Quote to display as card | Extract the punch (10-15 words max) |
| `[TEXT OVERLAY: "text"]` | Simple text emphasis | Very short (5-8 words) |
| `[VISUAL: description — GFX_XX]` | Graphic or visual element | Brief description |

---

## SCREEN TEXT CONSTRAINTS (NON-NEGOTIABLE)

| Element | Max Words | Max Characters | Notes |
|---------|-----------|----------------|-------|
| STAT ON SCREEN | 8-10 | ~50 | Numbers abbreviated (262K not 262,000) |
| QUOTE CARD | 10-15 | ~80 | Extract the punch, not the full quote |
| TEXT OVERLAY | 5-8 | ~40 | Very short — visual emphasis only |

### Number Formatting Rules

| Original | Screen Text |
|----------|-------------|
| 262,000 | 262K |
| $212 million | $212M |
| 19 percent | +19% or 19% |
| 3.9 million | $3.9M (if currency) or 3.9M |

---

## QUOTE SHORTENING RULES

When a quote exceeds 15 words:

1. **Extract the punch** — the most impactful phrase that captures the essence
2. **Use the punch as screen text** in the production tag
3. **Preserve the full quote** below the tag for narrator reference

### Quote Shortening Format

```markdown
[QUOTE CARD: "punch line extracted here" — q_XXX]

Full context: "The complete original quote that the narrator will read or reference..."
```

### Quote Shortening Examples

| Full Quote (45 words) | Screen Text (11 words) |
|----------------------|------------------------|
| "I've had people say they know layoffs are harmful to company well-being, let alone employee well-being, and don't accomplish much, but everybody is doing layoffs and their board is asking why they aren't." | "Everybody's doing layoffs and boards ask why they aren't" |
| "Cooperation demands that the fear of losing income will be eliminated... this can only be done by guaranteeing no layoffs." | "Fear of losing income must be eliminated" |

---

## TRANSFORMATION PROCESS

### Step 1: Identify Citations

Scan the script for:
- `[dp_XXX]` — data point citations
- `[q_XXX]` — quote citations

### Step 2: Look Up in Research Master

For each citation, find in `research_master.yaml`:

**For data points (`dp_XXX`):**
```yaml
data_points:
  - id: dp_044
    claim: "262,000 tech workers were laid off in 2023"
    source: "Layoffs.fyi"
    source_url: "https://layoffs.fyi/"
```

**For quotes (`q_XXX`):**
```yaml
quotes:
  - id: q_022
    text: "I've had people say they know layoffs are harmful..."
    speaker: "Jeffrey Pfeffer"
    source_url: "https://gsb.stanford.edu/..."
```

### Step 3: Generate Screen Text

Apply constraints:
- Abbreviate numbers
- Extract punch from long quotes
- Keep within character limits

### Step 4: Insert Production Tags

**Before (polished script):**
```markdown
[dp_044]
November 2022: tech layoffs hit 52,000. Two months later: 89,709. By year end: 262,000.
```

**After (with production tag):**
```markdown
[STAT ON SCREEN: "262K tech layoffs in 2023" — dp_044]

November 2022: tech layoffs hit 52,000. Two months later: 89,709. By year end: 262,000.
```

---

## DECISION RULES

### When to use STAT ON SCREEN

Use when the citation is a:
- Number, percentage, or dollar amount
- Comparative statistic (X vs Y)
- Date or timeline
- Count or quantity

### When to use QUOTE CARD

Use when:
- The quote is from a named speaker
- The quote is powerful enough to warrant visual emphasis
- The quote is a key moment in the narrative

### When to SKIP a tag

Skip production tag if:
- The citation is used only for sourcing (not screen-worthy)
- The data point is mentioned in passing (not emphasized)
- The information is purely contextual

Use judgment: not every citation needs a production tag. Only tag what should appear on screen.

### When citations would create consecutive tags

If two production tags would appear back-to-back without narration between them:

1. **Evaluate which is more screen-worthy** using these criteria:
   - Direct quotes from named speakers > statistics
   - Emotional impact > informational value
   - Central to the narrative moment > contextual detail
2. **Keep only the most important tag** — drop the other
3. **Never place consecutive tags** — editors cannot tell if simultaneous or sequential

Why this matters: Each tag creates a distinct visual moment. Back-to-back tags with no narration leave timing ambiguous for the editor.

---

## OUTPUT

`PRODUCTION_SCRIPT.md` — The polished script with production tags inserted

The structure follows production_sections from BEAT_GRAPH.yaml:
```markdown
## [PRODUCTION SECTION NAME]
[timestamp range from production_sections]

[PRODUCTION TAG if applicable]

Script text...

---

## [NEXT PRODUCTION SECTION NAME]
[timestamp range]

...
```

**Section headers come from BEAT_GRAPH.yaml production_sections** (typically 3-4 sections like "HOOK", "BUILD", "ESCALATE", "LAND"), NOT per-beat sections.

---

## VALIDATION CHECKLIST

Before completing, verify:

- [ ] All screen text respects character limits
- [ ] Long quotes have been shortened with full context preserved
- [ ] Numbers are abbreviated appropriately
- [ ] Production tags are placed BEFORE the relevant script text
- [ ] Not every citation has a tag (only screen-worthy items)
- [ ] Tags use the exact format: `[TAG TYPE: "text" — id]`
- [ ] No consecutive production tags without narrator text between them

---

## PRINCIPLES

1. **Editor-first** — The tag should tell the editor exactly what to put on screen
2. **Brevity wins** — Shorter screen text is always better
3. **Preserve narrator context** — Full quotes stay in script for reference
4. **Selective tagging** — Not everything needs a tag, only what belongs on screen
5. **Consistent format** — Always use `[TAG: "text" — id]` format
6. **One tag, one moment** — Never place production tags back-to-back; if consecutive, keep only the most important
