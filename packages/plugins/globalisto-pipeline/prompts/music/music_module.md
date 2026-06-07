# MUSIC MODULE

## MODEL SELECTION

| Step | Model | Rationale |
|------|-------|-----------|
| 12-A. Genre Lane Selection | Opus | 100% match vs DeepSeek-chat 50%; requires nuanced judgment |
| 12-B. Function Collapse | DeepSeek-chat | 100% match same as Opus; deterministic task, cheaper |
| 12-C. Suno Prompt Assembly | DeepSeek-chat | Requires artistic judgment for structure dynamics |
| 12-D. Duration Calculation | Script | `calculate_music_durations.js` - no LLM needed |

See test results below for detailed rationale.

---

## PURPOSE

Generate Suno-compatible music prompts from narrative structure.

This module transforms structural artifacts (beats, roles, blueprint) into executable Suno v5 prompts for documentary-style underscore. Music is designed to support cognition and narrative flow, NOT to author emotional meaning.

**This module performs NO music generation.** Output is a set of Suno-ready prompts for human execution.

**Production Sections Format (from BEAT_GRAPH.yaml):**
```yaml
production_sections:
  - section_id: 1
    name: "HOOK"
    mood: "shock"
    beats: ["BEAT_01", "BEAT_02"]
    timing: "0:00-0:30"
  - section_id: 2
    name: "BUILD"
    mood: "tension"
    beats: ["BEAT_03", "BEAT_04", "BEAT_05"]
    timing: "0:30-2:15"
  - section_id: 3
    name: "ESCALATE"
    mood: "urgency"
    beats: ["BEAT_06", "BEAT_07", "BEAT_08"]
    timing: "2:15-4:00"
  - section_id: 4
    name: "LAND"
    mood: "gravity"
    beats: ["BEAT_09", "BEAT_10"]
    timing: "4:00-5:00"
```

---

## INPUTS

| Input | Required | Purpose |
|-------|----------|---------|
| `BEAT_GRAPH.yaml` | Yes | Production sections (HOOK, BUILD, ESCALATE, LAND) with moods, beats, and timing |
| `NARRATIVE_BLUEPRINT.md` | Yes | Section structure and positions |
| `CONTENT_ROLE_MAP.yaml` | Yes | Section roles (ORIENT, EXPLAIN, etc.) |
| `VIDEO_RUN_CONTEXT` | For 12-A | Topic context for lane selection |
| `SUNO_STYLE_LIBRARY.yaml` | For 12-C | Style block definitions |
| `POLISHED_SCRIPT.md` | For durations | Word counts per production section |
| `MUSIC_FUNCTION_MAP.yaml` | For durations | Function per production section (from 12-B) |

---

## OUTPUTS

| Output | Purpose |
|--------|---------|
| `GENRE_ASSIGNMENT.yaml` | Lane per section (from 12-A) |
| `MUSIC_FUNCTION_MAP.yaml` | Function per section (from 12-B) |
| `MUSIC_DURATIONS.yaml` | Duration per section (from script) |
| `SUNO_PROMPT_SET.yaml` | Final Suno v5 prompts (from 12-C) |

---

## PARAMETERS

### Content Principles

Music in this pipeline:

**MAY amplify:**
- tension
- urgency
- gravity
- unease
- inevitability

**MUST avoid:**
- sentimentality
- heroism
- melodrama
- emotional payoff

This is a "no-cheese" rule, not a "no-emotion" rule.

---

## EXECUTION

This module runs in 4 steps. Steps 12-A and 12-B are independent and can run in parallel. Step 12-D (duration calculation) requires 12-B output.

### Step 12-A: Genre Lane Selection
**Prompt:** `prompt_12A_genre_lane_abstraction_gate.md`
**Model:** Opus

Select which genre lane (from 20 available) fits each production section based on narrative position and mood.
- INPUT: `BEAT_GRAPH.yaml` (production_sections), `NARRATIVE_BLUEPRINT.md`, `CONTENT_ROLE_MAP`, `VIDEO_RUN_CONTEXT`
- OUTPUT: `GENRE_ASSIGNMENT.yaml`

### Step 12-B: Music Function Collapse
**Prompt:** `prompt_12B_music_function_collapse.md`
**Model:** DeepSeek-chat

Collapse narrative structure into one of 6 fixed musical behavior primitives per production section.
- INPUT: `BEAT_GRAPH.yaml` (production_sections and beat_sequence), `NARRATIVE_BLUEPRINT.md`, `CONTENT_ROLE_MAP`
- OUTPUT: `MUSIC_FUNCTION_MAP.yaml`

### Step 12-D: Duration Calculation
**Script:** `scripts/calculate_music_durations.js`
**Model:** None (deterministic calculation)

Calculate music duration targets from word counts and function-specific WPM per production section.
- INPUT: `POLISHED_SCRIPT.md`, `BEAT_GRAPH.yaml` (production_sections), `MUSIC_FUNCTION_MAP.yaml`
- OUTPUT: `MUSIC_DURATIONS.yaml`

```bash
node scripts/calculate_music_durations.js POLISHED_SCRIPT.md MUSIC_FUNCTION_MAP.yaml
```

Function → WPM mapping (derived from S2-1 baseline):
| Function | WPM |
|----------|-----|
| ORIENT | 107 |
| EXPLAIN | 112 |
| INVESTIGATE | 121 |
| CONSEQUENCE | 95 |
| UNRESOLVED_CLOSE | 90 |
| TRANSITION | 105 |

### Step 12-C: Suno Style Block Assembler
**Prompt:** `prompt_12C_suno_style_block_assembler.md`
**Model:** DeepSeek-chat

Assemble final Suno v5 prompts by combining genre lanes, functions, durations, and style library blocks for each production section.
- INPUT: `GENRE_ASSIGNMENT.yaml`, `MUSIC_FUNCTION_MAP.yaml`, `MUSIC_DURATIONS.yaml`, `SUNO_STYLE_LIBRARY.yaml`
- OUTPUT: `SUNO_PROMPT_SET.yaml`

The LLM:
- Looks up style blocks from SUNO_STYLE_LIBRARY.yaml
- Applies function → modifier mapping
- Rotates emotion tokens per function occurrence
- Derives structure sections based on duration and artistic judgment
- Outputs SUNO_PROMPT_SET.yaml

---

## HARD CONSTRAINTS (NON-NEGOTIABLE)

This module may NOT:
- Generate or render music
- Add emotional interpretation not supported by structure
- Skip the genre/function split (they are independent dimensions)
- Use forbidden genre lanes (see 12-A prompt)
- Output prompts with vocals or CJK characters

This module MUST:
- Keep genre and function as independent dimensions
- Lead Suno prompts with style name (highest weight)
- Include instrumental declaration in every prompt
- Use MUSIC_DURATIONS.yaml target_duration (10s buffer pre-applied)

---

## PRINCIPLES

1. **Genre and function are independent** - lane selection knows nothing about function assignment
2. **Music supports cognition** - it does not author meaning
3. **No cheese** - engaging and dramatic, but no sentimentality or payoff
4. **Opening jolt** - openings need alertness, not calm
5. **Suno parses left-to-right** - style name must come first
6. **Duration from words** - calculated from word count × function WPM, not MASTER timestamps
7. **Buffer at end** - 10s buffer goes in LAND section, editor can cut shorter

---

## AVAILABLE GENRE LANES (20 Total)

### Backbone Lanes (4) - Always allowed, culturally neutral:
| Lane ID | Character |
|---------|-----------|
| BACKBONE_ANALYTICAL_ELECTRONIC | Clock-like pulse, clean, precise |
| BACKBONE_MINIMAL_PIANO | Repetitive motif, sparse, dry |
| BACKBONE_PULSING_SYNTH | Simple pulse, smooth flow |
| BACKBONE_MINIMAL_PERCUSSIVE | Muted percussion, grounded |

### Character Lanes (16) - Allowed when texture-first:
| Region | Lanes |
|--------|-------|
| Chinese | C1_CHINESE_HIPHOP_FUSION, C4_GUOCHAO, C5_GUFENG, C6_MODERN_CINEMATIC_CHINESE |
| Japanese | J1_WAFU_HIPHOP, J2_WAMONO, J3_TRAPANESE, J4_CITY_POP |
| Korean | K1_KOREAN_HIPHOP, K2_KRNB, K3_KOREAN_ELECTRONIC, K4_KOREAN_TRADITIONAL_FUSION |
| Pan-Asian | A1_ASIAN_LOFI, A2_ASIAN_ELECTRONIC_AMBIENT |
| Southeast Asian | SEA1_THAI_ELECTRONIC, SEA2_INDONESIAN_FUNK |

### Forbidden Lanes (NEVER select):
- C2_CLASSICAL_CHINESE_ORCHESTRAL
- C3_MANDAPOP_BALLAD
- K5_KPOP_BALLAD
- K6_KPOP_DANCE

---

## CANONICAL MUSICAL FUNCTIONS (6 Total)

| Function | Purpose | Constraints |
|----------|---------|-------------|
| ORIENT | Establish situational context, activate attention | No resolution, no reassurance |
| EXPLAIN | Support analytical explanation, reduce cognitive load | No drama, no tension |
| INVESTIGATE | Apply forward pressure, tension, unease | No payoff, no release |
| TRANSITION | Bridge time, place, or logical shift | No escalation, no emphasis |
| CONSEQUENCE | Allow weight to sit, emphasize gravity | No catharsis, no closure |
| UNRESOLVED_CLOSE | Conclude without resolution (final section only) | No comfort, no summary |

---

## INTEGRATION

### Upstream Dependencies
- Structure phase: `BEAT_GRAPH.yaml`, `CONTENT_ROLE_MAP.yaml`
- Writing phase: `NARRATIVE_BLUEPRINT.md`, `POLISHED_SCRIPT.md`

### Downstream
- Human execution: Suno v5 prompts for music generation
- Video editing: Music tracks cut to calculated durations

---

## MODEL SELECTION TEST RESULTS

*Test date: 2026-01-20*
*Test corpus: globalisto/outputs/S2-2_samsung_scale/_pipeline/*

### Step 12-A: Genre Lane Selection

| Model | Match Rate | Notes |
|-------|------------|-------|
| Opus | 4/4 (100%) | Perfect alignment with reference |
| DeepSeek-chat | 2/4 (50%) | Valid outputs but less aligned choices |
| DeepSeek-reasoner | Failed | No output returned |

**12-A Comparison:**
| Section | Reference | Opus | DeepSeek-chat |
|---------|-----------|------|---------------|
| HOOK | K1_KOREAN_HIPHOP | ✓ | ✓ |
| BUILD | BACKBONE_PULSING_SYNTH | ✓ | BACKBONE_ANALYTICAL_ELECTRONIC |
| ESCALATE | J3_TRAPANESE | ✓ | BACKBONE_MINIMAL_PERCUSSIVE |
| LAND | K2_KRNB | ✓ | BACKBONE_MINIMAL_PIANO |

**Analysis:** Opus significantly outperforms DeepSeek-chat on genre selection. This task requires nuanced judgment about narrative position, section type, and appropriate musical texture—exactly where Opus excels. DeepSeek-chat tends toward backbone lanes and misses character lane opportunities (ESCALATE).

### Step 12-B: Music Function Collapse

| Model | Match Rate | Notes |
|-------|------------|-------|
| Opus | 4/4 (100%) | Perfect alignment with reference |
| DeepSeek-chat | 4/4 (100%) | Perfect alignment with reference |
| DeepSeek-reasoner | 3/4 (75%) | Differs on BUILD: INVESTIGATE vs CONSEQUENCE |

**12-B Output (all models except reasoner):**
```yaml
functions:
  HOOK: ORIENT
  BUILD: EXPLAIN
  ESCALATE: INVESTIGATE
  LAND: UNRESOLVED_CLOSE
```

**Analysis:** 12-B is deterministic per decision tree. Both Opus and DeepSeek-chat follow the rules exactly. Since quality is identical, DeepSeek-chat is preferred for cost savings.

### Recommendation

- **12-A:** Use Opus (100% vs 50% match; requires nuanced judgment)
- **12-B:** Use DeepSeek-chat (100% match same as Opus; deterministic task, cheaper)
