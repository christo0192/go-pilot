# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S00 — Validation Gates
**Active Task**: T04 (T01, T02, T03 complete)
**Progress**: 0/8 slices complete · S00: 3/4 tasks complete
**Model Profile (target for build)**: pure-anthropic (start) → hybrid later
**Last Updated**: 2026-07-08

## Position
- S00/T01 scaffold+env — ✅
- S00/T02 concurrency — ✅ GO (10 concurrent claude sessions; need ~4–5)
- S00/T03 baseline rig — ✅ built + verified; ⭐ found ~44k/call system-prompt overhead (D15)
- S00/T04 task-class go/no-go — ⏳ NEXT — **needs builder's REAL task data + small measurement quota; run WITH user**

## ⭐ Pivotal finding (D15 / KNOWLEDGE)
Each Claude Code `-p` call re-pays ~44k tokens of system-prompt overhead. Multi-pane fan-out
has a high fixed cost per pane → worker panes MUST run lean (skills+MCP disabled), and fan-out
only pays off when per-subtask real work >> 44k. T04 measures which real task classes flip to GO.

## How to run T04
For each class (ads/MIS/transcript/deck/coding): build a fixture in scripts/baseline-rig/tasks/
with REAL representative input, then `python3 scripts/baseline-rig/run.py run tasks/<class>.json`,
score quality via metrics/quality-rubric.md, record verdict in docs/task-class-decisions.md.

## Not yet installed: Wezterm, Herdr, Pi, rtk, Docker. Installed: git, node, npm, python3, claude, codex.
