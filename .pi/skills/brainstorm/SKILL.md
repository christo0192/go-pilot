---
name: brainstorm
description: Generate and filter multiple approaches before committing to a plan. Use when the user says "brainstorm", "explore ideas", "what are the options", "evaluate approaches", or when a task has more than one viable design and the right one is not obvious. Produces ranked options with trade-offs and a recommendation. Makes NO code changes.
---

# Brainstorm

Diverge then converge on *approaches*, before any plan or code. Mirrors Go-pilot's phase-1 ideation.
Read-only: this skill never edits files or runs mutating commands.

## When to use

Use when there is genuine design ambiguity (2+ real options). Skip for trivial or single-path work —
going straight to `/skill:plan` is correct there (YAGNI applies to process too).

## Procedure

1. **Frame the problem** in one line: the goal + the hard constraint that makes it non-trivial. If a
   `.pi/state/alignment.md` exists, use its Goal/Constraints as the frame.

2. **Diverge — generate 3–5 distinct approaches.** Make them genuinely different (not one idea in
   five costumes). For each: a one-line description + the core mechanism.

3. **Converge — score each** against the constraints that matter. Prefer a small table:
   | Approach | Pro | Con | Cost/complexity | Reversibility |
   Weight by Go-pilot priors: **deterministic-first** beats clever-LLM; **YAGNI** kills speculative
   scope; reversible + measurable beats big-bang.

4. **Recommend one** with a one-paragraph rationale, and name the explicit trigger that would flip
   you to the runner-up (falsifiable condition).

5. **Stop.** Do not plan or build. Output the options + recommendation and hand off.

## Rules

- No file edits, no installs, no mutating shell. Reads and web/context lookups only.
- Surface the *loser's* best point — the recommendation is stronger when the trade-off is explicit.
- Keep it tight: a busy reader should get the recommendation in the first 5 lines.

## Chains to

`/skill:explore` (validate assumptions against the real codebase) → `/skill:plan`.
