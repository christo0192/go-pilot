---
name: phase-0-align
description: Phase-0 conversational alignment gate. Use FIRST, before any planning or building, to force a short user<->orchestrator alignment exchange (goal, constraints, success criteria, scope boundaries) and RECORD it. Blocks plan generation until alignment is captured. Trigger when a task is ambiguous, when the user says "let's build X" without agreed scope, or before /skill:plan or /skill:auto.
---

# Phase-0 Alignment Gate

The alignment gate that must pass **before any plan is generated or any code is written**.
Mirrors Go-pilot's "discuss before commit" muscle memory and enforces decision #5 (process gate).

## Why this exists

Plans built on unstated assumptions waste the most expensive resource (frontier tokens + human
review). One short alignment exchange up front is cheaper than a wrong plan. This gate is
deterministic: planning is blocked until a recorded alignment artifact exists.

## Procedure

1. **Do NOT plan or code yet.** If the user asked you to "just build it", still run this gate — it
   is short. Waive only if the user explicitly says "skip alignment".

2. **Conduct the alignment exchange.** Ask the user a tight set of questions (2–4, not a survey).
   Cover exactly these four fields; skip any the user already answered:
   - **Goal** — the outcome in one sentence. What is true when this is done?
   - **Constraints** — stack, platform, time, cost, "must not touch", dependencies.
   - **Success criteria** — how we verify done (tests pass, metric hit, artifact exists).
   - **Scope boundaries** — explicitly in-scope vs out-of-scope; the YAGNI line.

3. **Reflect back** a 3–5 line summary and ask the user to confirm or correct. Do not proceed on
   silence — require an explicit "yes/looks right" or a correction.

4. **RECORD the alignment** to `.pi/state/alignment.md` (create the `.pi/state/` dir if missing).
   Use this exact shape so `/skill:plan` can detect it:

   ```markdown
   # Alignment — <short task name>
   status: aligned
   date: <YYYY-MM-DD>

   ## Goal
   <one sentence>

   ## Constraints
   - <...>

   ## Success criteria
   - <...>

   ## Scope
   in:  <...>
   out: <...>

   ## Confirmed
   User confirmed: <quote or paraphrase of their yes/correction>
   ```

5. **Announce the gate is open:** "Alignment recorded — planning unblocked. Next: `/skill:plan`."

## Rules

- Keep it conversational and short — this is a gate, not a spec-writing exercise.
- `status: aligned` + the `## Confirmed` block are the machine-checkable signal. Never write them
  until the user has actually confirmed.
- If the user changes direction later, re-run this gate and overwrite the artifact.
- Do not summarize away disagreements — if the user pushed back, record what changed.

## Chains to

`/skill:plan` (blocked until this artifact exists) → `/skill:execute` → `/skill:auto`.
