---
name: orchestrate
description: Plan a multi-step task and DELEGATE each subtask to a Kimi/DeepSeek workhorse via herdr, then assemble the results. Use when the user gives a task to "orchestrate", "farm out", "delegate", or complete cheaply using the workhorse models while you (the frontier model) only plan, route, verify, and assemble. You own control flow; the workhorses produce the content.
---

# Orchestrate

> NOTE: this is the **Pi-side** variant (for a Pi-driven orchestrator, an extra-usage
> billing path — see scripts/pi-orchestrate.sh header). The production orchestrator is
> **Claude Code**, whose framework lives in the repo-root `CLAUDE.md` + `.claude/skills/`.

You are the **orchestrator**. Your job is **control flow, not content**: decompose the task, route
each piece to the cheapest capable workhorse, verify it, sequence the pieces, and assemble the final
result. You do **not** write the deliverable content yourself — the workhorses do. (This preserves the
cost model: the expensive frontier model conducts; the cheap models play.)

## The delegation primitive

Run each subtask on a workhorse with:

```bash
scripts/pi-delegate.sh <model> "<subtask prompt>"
```

- `<model>` is `deepseek` or `kimi` (or a full `provider/id`).
- It spawns a herdr worker pane, runs the subtask on that model (headless Pi, tools enabled), and
  prints the worker's result to stdout. It blocks until the worker finishes (workhorses can take
  30–60s; that is normal).
- Call it from your **bash** tool. The stdout you get back IS the worker's answer.

## Model routing (from the S11 benchmark)

- **deepseek** — default for anything with a checkable/structured answer: **code, math, reasoning,
  repo edits, extraction, data shaping, summarization**. It matched Opus quality on deterministic
  tasks, is ~10× cheaper than Kimi, and is the most reliable.
- **kimi** — for **creative drafting, brainstorming, long-document synthesis, lateral/exploratory**
  work where a more verbose, exploratory style helps.
- When unsure, pick **deepseek** (cheaper + reliable).

## Procedure

1. **Plan (you, silently).** Break the task into the smallest set of concrete, independently-runnable
   subtasks. For each, note: the exact subtask prompt, its assigned workhorse, its `Depends on:`, and
   a **Done-when** check (a command/test/observable that proves it succeeded). Do not start executing
   content yourself.

2. **Delegate each subtask** with `scripts/pi-delegate.sh <model> "<subtask>"`. Make the subtask
   prompt self-contained — include any inputs and prior-step results it needs (workers share no memory
   with you). For a subtask that outputs code/JSON, tell the worker to output ONLY that.

3. **Verify deterministically (mandatory, before trusting a result).** Run the subtask's Done-when
   check on the returned output — run the code/tests, validate the JSON, check the number. Never trust
   a worker's self-description; check the artifact.

4. **Repair within the workhorse tier — never escalate content to yourself.** If a result is empty,
   truncated, timed out, or fails its Done-when check: re-delegate ONCE with a stricter, more explicit
   subtask prompt; if it still fails, reassign to the OTHER workhorse (deepseek↔kimi). Only after both
   fail do you report the subtask as blocked. You do not write the content to "rescue" it.

5. **Sequence.** Feed each verified result forward as context into dependent subtasks. Independent
   subtasks may be delegated back-to-back. (For parallelism you can background several
   `scripts/pi-delegate.sh ... &` calls and collect their outputs, but keep it simple first.)

6. **Assemble.** Stitch the verified worker outputs into the final deliverable. Keep this to
   **structural assembly** (ordering, wiring, formatting, applying edits) — do not rewrite the
   workers' content. Apply file edits with your own tools if the task is a repo change.

7. **Report (boomerang).** Summarize: the subtask breakdown, which workhorse did each, the Done-when
   result for each, any repairs/reassignments, and the final assembled deliverable. Keep it short;
   reference paths, not full dumps.

## Boundaries
- **Control, not content.** You plan/route/verify/sequence/assemble. Workhorses produce the answers.
- **Verify before trust.** A result is "done" only when its deterministic check passes.
- **No silent failures.** A blocked subtask is reported as blocked, with the exact failure.
