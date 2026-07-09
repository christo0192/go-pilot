# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S03 — Router + Context Tiering (S02 skipped: pure-anthropic)
**Active Task**: S03/T01 — deterministic router (next session)
**Progress**: 2/8 slices (S00 ✅, S01 ✅) · S02 skipped (pure-anthropic) · next S03 Router
**Model Profile**: pure-anthropic (claude+codex installed; no LiteLLM/Pi needed yet)
**Last Updated**: 2026-07-09

## S00 — CLOSED ✅ (GO to build)
- T01 scaffold ✅ · T02 concurrency GO (10 sessions) ✅ · T03 baseline rig ✅ · T04 SKIPPED (D17 policy)
- Key: D16 lean-worker cuts ~60% cost/call. Rig ready for per-class validation on demand.

## S01 — Substrate + Frontier Plane (active)
- T01 ✅ herdr 0.7.3 installed; headless socket API + orchestration loop proven (panes/herdr-orchestration.md). Server running bg this session.
- T02 wrap claude pane — ⏳ NEXT — needs decision on integration hook (writes to ~/.claude) + design: lean `claude -p` worker vs interactive TUI pane
- T02 wrap claude pane · T03 wrap codex pane · T04 claude-presence · T05 worktree-per-pane
- pure-anthropic: no LiteLLM/Pi this slice.

## Installed: git, node, npm, python3, claude 2.1.204, codex 0.143.0.  Missing: wezterm, herdr, pi, rtk, docker.
