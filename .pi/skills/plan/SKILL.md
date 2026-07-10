---
name: plan
description: Decompose a task into a step-by-step implementation plan. Use when the user says "plan", "break this down", "what are the steps", "roadmap", or before executing non-trivial work. GATED — requires a recorded alignment (.pi/state/alignment.md) from /skill:phase-0-align first; refuses to plan without it. Produces an ordered, verifiable plan and makes no code changes.
---

# Plan

Turn an aligned goal into an ordered, verifiable plan. Mirrors Go-pilot's phase-5 planning.
Planning only — no code changes here.

## PRECONDITION (hard gate)

**Before doing anything else**, check that `.pi/state/alignment.md` exists AND contains `status: aligned`
plus a `## Confirmed` block.

- If it is **missing or not aligned**: STOP. Do not produce a plan. Respond:
  "No recorded alignment found. Run `/skill:phase-0-align` first — planning is blocked until goal,
  constraints, and success criteria are captured." Then stop.
- If present: read it and use its Goal / Constraints / Success criteria / Scope as the plan's basis.

This enforces decision #5: no plan is generated until alignment is recorded.

## Procedure

1. **Restate** the goal + success criteria from the alignment artifact in one line each.

2. **Decompose into ordered steps.** Each step must have:
   - a clear action (verb + object),
   - explicit `Depends on:` (or "Independent"),
   - a **Done-when** acceptance check that is *verifiable* (a command, a test, an observable state),
   - a rough size (Simple / Medium / Complex).
   Keep steps small enough to execute and verify one at a time. Front-load the risky/uncertain steps.

3. **Deterministic-first.** Prefer steps a script/test can verify over steps needing human judgment.
   Flag any step that genuinely needs LLM judgment as the costed exception, not the default.

4. **YAGNI pass.** Delete any step not required by the success criteria or scope. Note what you cut.

5. **Emit the plan** as an ordered checklist. For task specs handed to workers, prefer compact TOON
   over verbose JSON (fewer tokens, #1). Write the plan to `.pi/state/plan.md` so `/skill:execute`
   and `/skill:auto` can pick it up.

## Rules

- Never skip the precondition gate.
- No code changes, installs, or mutating commands in this stage.
- Every step ends in a verifiable Done-when — "looks good" is not acceptance.
- Order by dependency and risk; a reader should be able to execute top-to-bottom.

## Chains to

`/skill:execute` (one step at a time) or `/skill:auto` (autonomous loop over all steps).
