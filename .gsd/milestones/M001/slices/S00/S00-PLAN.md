# S00: Validation Gates

Hard gate — no router/harness code until T04 records a GO/NO-GO per task class.

## Tasks
- [x] **T01: Repo scaffold & environment inventory** `est:done`
  Depends on: Independent
  Instructions: git init; create dir tree (docs/config/scripts/panes/metrics/src); README, .gitignore, .env.example; docs/environments.md populated with detected tool versions per OS. Done: repo clones + env inventory recorded. ✅ (see T01-SUMMARY.md)

- [x] **T02: Concurrent-session safety spike** `est:done` ✅ 2026-07-08 — 10 concurrent claude sessions spawned (need ~4–5); GO. See docs/concurrency-report.md.
  Depends on: T01
  Instructions: Follow `scripts/concurrency-spike.md`. Run 2/3/4 concurrent `claude` (Opus+Sonnet+Haiku) sessions under ONE Max login + a `codex` session; measure rate-limit errors, session-file/lock contention, dropped turns. Repeat on Mac. Record in `docs/concurrency-report.md`: max safe concurrent sessions per OS + fallback trigger. **Requires user's interactive login — cannot be run by an autonomous agent.**
  Done when: docs/concurrency-report.md states max safe concurrent sessions per OS.

- [x] **T03: Baseline-paradox measurement rig** `est:done` ✅ 2026-07-08 — scripts/baseline-rig/run.py verified; ⭐ found ~44k/call system-prompt overhead (D15). See T03-SUMMARY.md.
  Depends on: T01
  Instructions: Build a rig (scripts/baseline-rig/) that runs a task (a) single-agent and (b) multi-pane, capturing total tokens + a quality score (rubric in metrics/quality-rubric.md). Verify on one trivial task class.
  Done when: rig outputs {tokens_single, tokens_multi, quality_single, quality_multi} reproducibly.

- [~] **T04: Task-class go/no-go decision record** `SKIPPED by user 2026-07-09`
  Policy (D17): rig (scripts/baseline-rig) is built and ready; any task class defaults to
  **single-agent** until validated with the rig before relying on multi-pane for it. This
  preserves the no-negative-return principle without running the measurement now.
  Depends on: T02, T03
  Instructions: Run rig on top 5 task classes (ads analysis, MIS reporting, transcript analysis, deck drafting, coding). Mark GO only if multi-pane ≥20% token cut at ≤5% quality loss. Write docs/task-class-decisions.md.
  Done when: every candidate task class has a recorded GO/NO-GO with numbers.
