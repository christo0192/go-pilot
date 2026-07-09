# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S01 — Substrate + Frontier Plane
**Active Task**: T01 (S01/T01 — install Wezterm + Herdr)
**Progress**: 1/8 slices complete (S00 ✅) · S01: 0/5 tasks
**Model Profile**: pure-anthropic (claude+codex installed; no LiteLLM/Pi needed yet)
**Last Updated**: 2026-07-09

## S00 — CLOSED ✅ (GO to build)
- T01 scaffold ✅ · T02 concurrency GO (10 sessions) ✅ · T03 baseline rig ✅ · T04 SKIPPED (D17 policy)
- Key: D16 lean-worker cuts ~60% cost/call. Rig ready for per-class validation on demand.

## S01 — Substrate + Frontier Plane (active)
- T01 install Wezterm + Herdr — ⏳ NEXT (herdr = WSL CLI, may attempt install; Wezterm = Windows GUI, user installs)
- T02 wrap claude pane · T03 wrap codex pane · T04 claude-presence · T05 worktree-per-pane
- pure-anthropic: no LiteLLM/Pi this slice.

## Installed: git, node, npm, python3, claude 2.1.204, codex 0.143.0.  Missing: wezterm, herdr, pi, rtk, docker.
