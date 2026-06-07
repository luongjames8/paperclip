# Kill Decision Framework

**Version:** 1.0
**Last Updated:** 2026-03-04
**Type:** Reference document (not a pipeline step)

## Purpose

Defines when to kill an angle, how to pivot, and the decision tree for choosing between pivot and kill. Prevents sunk-cost thinking — killing a bad angle early saves 10x the effort of rescuing it in production.

---

## When to Kill

An angle should be killed when it cannot deliver on its promise and no viable pivot exists.

### Kill Triggers

| Trigger | Description |
|---------|-------------|
| **Post-research validation failure** | Research phase reveals the angle's core claim is unsupported, exaggerated, or already debunked — and no reframing salvages it |
| **SERP audit failure (no rewording viable)** | Title fails SERP audit — search ecosystem doesn't support the angle, and no rewording produces a viable title |
| **Trinity gate double-fail** | Title-thumbnail-hook alignment fails twice with no convergence path — the elements tell different stories and can't be unified |
| **Evidence contradiction** | Core evidence contradicts the angle rather than supporting it, and the contradiction isn't interesting enough to become the new angle |
| **Ecosystem mismatch** | The topic exists but YouTube's audience for it is too small, too saturated, or misaligned with channel positioning |

---

## Kill Process

### Step 1: Confirm Kill

Before killing, verify:
- [ ] At least one pivot type (see below) has been considered
- [ ] The failure is in the angle, not in the execution of the research
- [ ] No reframing of the same evidence produces a viable angle

### Step 2: Load Runner-Up

1. Pull runner-up proposals from the original angle generation phase (`1_agent_proposals.md` output)
2. Re-run SERP audit (`1b_serp_audit.md`) on the next-best proposal
3. If runner-up passes SERP audit → swap and continue from Research phase
4. If runner-up fails → try third proposal

### Step 3: If All Proposals Dead

If all 3 original proposals fail:
1. Document specific learnings:
   - Why each angle failed (evidence gap? ecosystem? framing?)
   - What the research DID reveal that might seed new angles
   - Any surprising findings that contradict initial assumptions
2. Return to Discovery phase with these learnings as input
3. Discovery should treat the failed angles as constraints: "We know X doesn't work because Y"

---

## Named Pivot Types

| Pivot Type | Definition | Example |
|------------|------------|---------|
| **Scope** | Same topic, narrower or broader | "How Sony Failed" → "How Sony Lost the Music Industry" (narrower) |
| **Frame** | Same facts, different interpretive lens | "How Sony Failed" → "Why Sony's Success Caused Its Failure" (causality flip) |
| **Audience** | Same insight, different target viewer | Business audience → gaming audience (same Sony facts, different emotional hook) |
| **Format** | Same insight, different content format | Documentary → comparison ("Sony vs Samsung: Who Made the Bigger Mistake?") |
| **Topic** | Pivot to adjacent topic using same research | Sony → "Why Japanese Tech Giants Keep Making the Same Mistake" (generalize) |

### Pivot Sequencing

Try pivots in this order (least disruptive first):
1. **Frame** — cheapest pivot, reuses all research
2. **Scope** — reuses most research, adjusts depth
3. **Audience** — reuses research, changes packaging
4. **Format** — reuses research, changes structure
5. **Topic** — most expensive, but salvages research investment

---

## Pivot vs Kill Decision Tree

```
Evidence partially supports the angle?
├── YES → PIVOT (try Frame or Scope first)
└── NO → Evidence actively contradicts?
    ├── YES → Any pivot viable?
    │   ├── YES → PIVOT (the contradiction might be the better angle)
    │   └── NO → KILL
    └── NO (evidence is just insufficient)
        → Can more research fill the gap?
            ├── YES (and worth the effort) → RESEARCH MORE
            └── NO → KILL

Ecosystem mismatch only? (angle is valid but YouTube audience isn't there)
→ REPACKAGE: Different title, different thumbnail, same content
  (The angle is sound — the packaging is wrong)

Unique contribution unclear? (angle is valid but others have covered it)
├── Can you sharpen to a specific uncovered sub-angle? → DIFFERENTIATE
└── No differentiation possible → KILL
```

### Decision Outputs

| Decision | Next Action |
|----------|-------------|
| **PIVOT** | Apply named pivot type, re-run from SERP audit |
| **KILL** | Load runner-up proposal (see Kill Process) |
| **REPACKAGE** | Return to packaging with new title/thumbnail concepts, keep script direction |
| **DIFFERENTIATE** | Return to angle lock with sharper unique contribution, re-run Trinity gate |
| **RESEARCH MORE** | Return to Research phase with specific questions to answer |

---

## Anti-Patterns

- **Sunk cost rescue:** "We've done so much research, let's just make it work" → If the angle is dead, the research is sunk. Move on.
- **Frankenstein pivot:** Combining two dead angles into one → Usually produces a confused video. Pick one direction.
- **Soft kill:** Proceeding with a "maybe it'll work" angle → It won't. Kill decisively or pivot with conviction.
- **Premature kill:** Killing after one research setback → Verify the failure is in the angle, not in incomplete research.

---

*Kill fast, learn faster. Every dead angle teaches you something about what works.*
