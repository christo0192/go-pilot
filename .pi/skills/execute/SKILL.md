---
name: execute
description: Implement one planned step with verification. Use when the user says "execute", "do it", "implement step N", "build this", after a plan exists. Implements a single step, runs its Done-when check, and only reports success if the check passes. Use /skill:plan first to produce the plan.
---

# Execute

Implement one planned step and prove it works. Mirrors Go-pilot's phase-6 execution + the
validate-before-compress invariant (#6).

## Procedure

1. **Pick the step.** Read `.pi/state/plan.md` (or take the step named in the arguments). Confirm its
   `Depends on:` steps are already done. If a dependency is unmet, stop and say which.

2. **Restate the step + its Done-when** in one line before touching anything.

3. **Implement the smallest change** that satisfies the step. Match existing conventions found during
   `/skill:explore`. Do not gold-plate or pull in unrequested scope (YAGNI).

4. **VALIDATE — this is mandatory and comes before any success claim (#6):**
   - Run the step's Done-when check (the test / command / observable state).
   - If it **fails**: do NOT summarize it as done. Report the failure *in full detail* (exact error),
     fix and re-verify, or escalate up the chain if blocked. Failures propagate verbatim — never
     smoothed into a clean summary.
   - If it **passes**: only then may you compress the result into a short summary.

5. **Report (boomerang).** After passing, report up a *short* summary: what changed (file paths), the
   check that passed, and anything the next step needs to know. Reference paths, not full diffs (#1).

6. **Update state.** Mark the step done in `.pi/state/plan.md`.

## Rules

- **Validate before you compress.** No "done" without a passing Done-when. This is the core rule.
- One step at a time; do not run ahead into later steps.
- Keep changes minimal and reversible; prefer editing existing files over adding new ones.
- Report file paths + the passing check, not pasted full file contents.
- If you touched auth/input/external I/O, note it so a security pass can follow.

## Chains to

Back to `/skill:plan` for the next step, or driven in a loop by `/skill:auto`.
