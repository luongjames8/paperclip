# MIDROLL PLACEMENT (Step 4 of YouTube Module)

## PURPOSE

Identify optimal midroll ad positions that maximize monetization while preserving viewer retention.

---

## INPUTS

| Input | Source | Purpose |
|-------|--------|---------|
| `BEAT_GRAPH.yaml` | phase_5 | Production sections and mood design |
| `POLISHED_SCRIPT.md` | phase_10 | Actual content and pacing |
| `video_overview` | YOUTUBE_PACKAGE.yaml | Runtime and key moments |

---

## PLACEMENT PRINCIPLES

### Where TO Place Midrolls

1. **Section transitions** — Natural break between topics
2. **Tension valleys** — After a payoff, before the next build
3. **Topic shifts** — When the narrative changes direction
4. **Recap moments** — After summarizing before moving forward

### Where NOT TO Place Midrolls

1. **Hook zone** — First 60-90 seconds (kills retention)
2. **Climax** — Peak emotional/revelation moment
3. **Pre-payoff** — Right before a reveal or answer
4. **Mid-sentence** — Never break a thought
5. **Final 60 seconds** — Outro/CTA zone

### Density Guidelines

| Video Length | Recommended Midrolls | Spacing |
|--------------|---------------------|---------|
| 8-10 min | 1-2 | Every 3-4 min |
| 10-15 min | 2-3 | Every 3-4 min |
| 15-20 min | 3-4 | Every 4-5 min |
| 20+ min | 4-6 | Every 4-5 min |

---

## PROMPT

```
You are a YouTube monetization strategist. Your job is to find the best midroll ad positions that maximize revenue without hurting viewer retention.

Read the inputs below and identify optimal midroll positions.

## Your Task

1. **Read production_sections from BEAT_GRAPH.yaml** — These define natural narrative boundaries (typically 3-4 sections)
2. **Map the video structure** — List all production sections with their timings and moods
3. **Identify key moments** — Hook, climax, reveals (these are NO-GO zones)
4. **Find natural breaks** — Use production_section boundaries and mood field to identify tension valleys
5. **Recommend positions** — Specific timecodes with rationale

## Evaluation Criteria

For each potential position, consider:
- **Natural boundaries** — Production section transitions are pre-designed narrative breaks
- **Mood valleys** — Check the mood field; place ads after tension resolution, not during buildup
- Is this a natural pause point? (viewer won't feel interrupted)
- Is something being built up? (if yes, DON'T place here)
- Did something just resolve? (if yes, GOOD placement)
- How long since the last ad? (aim for 3-5 min spacing)

**PRIORITY:** Use production_section boundaries as primary candidates. They align with natural narrative structure.

## Output Format

Provide your analysis in this exact YAML structure:

```yaml
midroll_positions:
  video_runtime: "[X:XX]"
  recommended_count: [N]

  structure_map:
    - section: "[Section name]"
      time: "[start] - [end]"
      type: "hook|build|reveal|valley|transition|climax|outro"

  avoid_zones:
    - start: "[X:XX]"
      end: "[X:XX]"
      reason: "[Why ads would hurt retention here]"

  positions:
    - position: 1
      timecode: "[X:XX]"
      section_context: "End of [X] / Start of [Y]"
      placement_type: "section_transition|tension_valley|topic_shift|recap"
      confidence: "high|medium"
      rationale: "[Why this works - what just resolved, what's about to start]"

    - position: 2
      timecode: "[X:XX]"
      section_context: "..."
      placement_type: "..."
      confidence: "..."
      rationale: "..."

  editor_notes:
    - "[Any specific guidance for the editor]"
```

## Important

- YouTube requires videos to be 8+ minutes for midroll eligibility
- If the video is under 8 minutes, output: `midroll_positions: null` with a note
- Prioritize retention over ad count — fewer well-placed ads beat many bad ones
- When in doubt, place AFTER resolution, not BEFORE
```

---

## OUTPUT

Append to `YOUTUBE_PACKAGE.yaml`:

```yaml
midroll_positions:
  video_runtime: "[X:XX]"
  recommended_count: [N]

  structure_map:
    - section: "[name]"
      time: "[range]"
      type: "[type]"

  avoid_zones:
    - start: "[X:XX]"
      end: "[X:XX]"
      reason: "[reason]"

  positions:
    - position: 1
      timecode: "[X:XX]"
      section_context: "[context]"
      placement_type: "[type]"
      confidence: "[level]"
      rationale: "[why]"

  editor_notes:
    - "[guidance]"
```

---

## EXECUTION OPTIONS

| Model | When to Use |
|-------|-------------|
| **DeepSeek (Recommended)** | Default choice — matches Opus positions at lower cost |
| Claude (Opus) | Only if editor guidance quality is critical |

> **Tested (RUN_20260119_1026)**: DeepSeek and Opus 4.5 produced identical ad positions. Opus had richer rationale but same placements. Use DeepSeek for routine runs.

---

## TIPS

- If the AI suggests too many midrolls, ask it to "prioritize the top 2-3 highest confidence placements"
- If placements feel wrong, share specific concerns — "this is right before a reveal, find a better spot"
- The structure_map is useful for editors even beyond ad placement
