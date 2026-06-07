# EDITOR RESOURCES ASSEMBLY (Step 7 of YouTube Module)

## PURPOSE

Generate a self-contained resource table at the bottom of the master file so video editors never need to open the research YAML.

All sources, quotes, and visual assets referenced in the script are collected with HTTP links for one-click verification.

---

## INPUTS

| Input | Source |
|-------|--------|
| `PRODUCTION_SCRIPT.md` | Step 6 output (script with production tags) |
| `research_master.yaml` | phase_2 output (contains source URLs) |

---

## WHAT THIS STEP DOES

1. **Parse the script** for all referenced IDs (`dp_XXX`, `q_XXX`, `GFX_XX`, `CLIP_XX`)
2. **Look up each ID** in `research_master.yaml` to get source URLs
3. **Build resource tables** organized by type (stats, quotes, visuals)
4. **Include HTTP links** so editors can verify with one click
5. **Flag missing URLs** for manual follow-up

---

## OUTPUT FORMAT

Generate a markdown section to append to the master file:

```markdown
## EDITOR RESOURCES

All sources referenced in this script. Click links to verify or find additional context.

### Stats & Data Points

| ID | Screen Text | Source | Link |
|----|-------------|--------|------|
| dp_044 | 262K tech layoffs in 2023 | Layoffs.fyi | [layoffs.fyi](https://layoffs.fyi/) |
| dp_047 | Meta stock +19% in one day | MarketWatch | [marketwatch.com](https://www.marketwatch.com/story/meta-stock-rally) |
| dp_053 | 112,000 GE jobs cut | SEC filings | [sec.gov](https://www.sec.gov/...) |

### Quotes

| ID | Screen Text | Speaker | Source | Link |
|----|-------------|---------|--------|------|
| q_022 | "Everybody's doing layoffs..." | Jeffrey Pfeffer | Stanford GSB | [gsb.stanford.edu](https://gsb.stanford.edu/...) |
| q_033 | "They gave us 60 days..." | Anonymous | ABC7 | [abc7.com](https://abc7.com/...) |

### Visual Assets Needed

| ID | Description | Priority | Notes |
|----|-------------|----------|-------|
| GFX_02 | Bay Area heat map (36%) | HIGH | Create animated map showing concentration |
| GFX_04 | Stock jump animation | HIGH | Meta +19%, Uber +50% — animated chart |
| CLIP_02 | Welch photos, GE HQ | MEDIUM | Search "Jack Welch GE headquarters" |

### Missing URLs

The following items need manual URL verification:

| ID | Claim/Text | Action Needed |
|----|------------|---------------|
| dp_089 | SEC filing reference | Find direct SEC link |
```

---

## ASSEMBLY PROCESS

### Step 1: Extract All IDs from Script

Scan `PRODUCTION_SCRIPT.md` for patterns:
- `dp_\d{3}` — data point IDs
- `q_\d{3}` — quote IDs
- `GFX_\d{2}` — graphic IDs
- `CLIP_\d{2}` — clip IDs

Collect unique IDs only (no duplicates).

### Step 2: Look Up Each ID

For each ID, find in `research_master.yaml`:

**Data points:**
```yaml
data_points:
  - id: dp_044
    claim: "262,000 tech workers were laid off in 2023"
    source: "Layoffs.fyi"
    source_url: "https://layoffs.fyi/"
```

**Quotes:**
```yaml
quotes:
  - id: q_022
    text: "I've had people say..."
    speaker: "Jeffrey Pfeffer"
    source: "Stanford GSB"
    source_url: "https://gsb.stanford.edu/..."
```

### Step 3: Build Tables

**Stats & Data Points table:**
- ID
- Screen Text (from production tag, or shortened claim)
- Source (human-readable name)
- Link (clickable markdown link)

**Quotes table:**
- ID
- Screen Text (the shortened punch line)
- Speaker
- Source
- Link

**Visual Assets table:**
- ID
- Description (what needs to be created/found)
- Priority (HIGH if critical to understanding, MEDIUM otherwise)
- Notes (search suggestions, specific requirements)

### Step 4: Handle Missing URLs

If `source_url` is missing or empty in the YAML:
- Add to "Missing URLs" section
- Include the claim/text so editor knows what to search for
- Suggest action: "Find direct link" or "Verify source"

---

## SORTING RULES

**Order by appearance in script** (not alphabetically).

This matches editor workflow — they'll encounter items in script order.

---

## LINK FORMATTING

Use markdown links with shortened display text:

| Source URL | Display As |
|------------|------------|
| `https://layoffs.fyi/` | `[layoffs.fyi](https://layoffs.fyi/)` |
| `https://www.marketwatch.com/story/meta-stock-rally` | `[marketwatch.com](https://www.marketwatch.com/story/meta-stock-rally)` |
| `https://gsb.stanford.edu/faculty-research/...` | `[gsb.stanford.edu](https://gsb.stanford.edu/...)` |

Extract domain for display, keep full URL in link.

---

## VISUAL ASSET NOTES

For GFX and CLIP items, provide helpful notes:

**For graphics (GFX):**
- What data to include
- Style suggestions (animated, static, chart type)
- Key numbers that must be visible

**For clips (CLIP):**
- Search terms for stock footage
- Specific subjects needed
- Time period if relevant

---

## OUTPUT

Use the following delimiter format to separate the two output files:

```
--- FILE: EDITOR_RESOURCES.md ---
(editor resources markdown content here — see format above)
--- FILE: PACKAGING_COMPLETE.yaml ---
status: complete
step: packaging:step_7
editor_resources_generated: true
ids_accounted_for: [count]
missing_urls: [count]
```

`EDITOR_RESOURCES.md` will be appended to the final master file by `packaging_module.js`.
`PACKAGING_COMPLETE.yaml` signals that the packaging module has finished and gates downstream handoff.

---

## VALIDATION CHECKLIST

Before completing, verify:

- [ ] All IDs from the script are accounted for
- [ ] Every item with a URL has a clickable link
- [ ] Missing URLs are clearly flagged
- [ ] Tables are sorted by script appearance order
- [ ] Visual assets have helpful notes for editor
- [ ] No duplicate entries

---

## PRINCIPLES

1. **Self-contained** — Editor never needs to open the YAML
2. **One-click verification** — All links are clickable
3. **Script order** — Tables match editor's workflow
4. **Honest about gaps** — Missing URLs are flagged, not hidden
5. **Actionable notes** — Visual assets include search suggestions
