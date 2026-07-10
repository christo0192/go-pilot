---
name: auto
description: Autonomous workflow loop that chains alignment -> brainstorm -> explore -> plan -> execute with file-based state. Use when the user says "auto", "autonomous mode", "just build the whole thing", "run the milestone", or wants the full workflow driven end-to-end with minimal check-ins. Mirrors gsd-auto. Respects the Phase-0 alignment gate before any planning.
---

# Auto

The autonomous state machine that drives the whole workflow, chaining the other skills. Mirrors
Go-pilot's `gsd-auto`. It is a **coordinator**: it calls the stage skills in order and keeps state on
disk so a fresh session can resume.

## State

All state lives under `.pi/state/` (create if missing):
- `alignment.md` — the Phase-0 gate artifact (from `/skill:phase-0-align`).
- `plan.md` — the ordered plan with per-step Done-when + done ticks (from `/skill:plan`).
- `auto-state.json` — `{ stage, current_step, status, updated }` for resume.

At start, **read `auto-state.json` first** and resume from where it left off (mirrors session-start
recall). If absent, start at the alignment gate.

## The loop

Run these stages in order. Do not skip the gate.

1. **ALIGN (gate).** If `alignment.md` is missing or not `status: aligned`, run `/skill:phase-0-align`
   and stop the loop until the user has confirmed. Planning is blocked until this passes (#5). This is
   the one point that *requires* a human exchange — everything after can run autonomously.

2. **BRAINSTORM (conditional).** If the approach is ambiguous (2+ real options), run
   `/skill:brainstorm` and adopt the recommendation. Skip for single-path work (YAGNI).

3. **EXPLORE (conditional).** If the codebase/area is not already understood, run `/skill:explore` and
   feed the findings forward. Skip if the ground is already mapped.

4. **PLAN.** Run `/skill:plan` (it re-checks the alignment gate). Produces `plan.md`.

5. **EXECUTE loop.** For each unfinished step in `plan.md`, in dependency order:
   - Run `/skill:execute` on that step.
   - It must pass its Done-when before the step is marked done (validate-before-compress, #6).
   - If a step **fails and cannot be fixed**, STOP the loop, report the failure in full, and escalate
     to the user (chain-of-command #4). Never mark a failed step done or smooth it into a summary.
   - After each step, update `auto-state.json`.

6. **FINISH.** When all steps are done, report a compact summary of what shipped + how it was verified.
   Distill only the validated keepers (decisions, gotchas) into the run summary — not scratch.

## Rules

- **The Phase-0 gate is non-negotiable** — never generate a plan or write code before `alignment.md`
  is `aligned`.
- Reference the other stages by their `/skill:` names — do not re-implement them here.
- Persist state after every stage so the loop is resumable (deterministic-first coordination).
- Boomerang: each stage reports a short summary upward; full detail stays local unless it is a failure.
- Stop and ask the user at: the alignment gate, an unrecoverable step failure, or a scope change that
  invalidates the plan. Otherwise keep going.

## Profiles

Stage *behavior* is identical across Go-pilot's `pure-anthropic` / `hybrid` / `open-first` profiles;
only which model tier runs each stage changes (set via `/model`). Cheap-but-reliable models can run
explore/execute fan-out; keep alignment + planning on the stronger tier.
