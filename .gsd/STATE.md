# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S04 — Memory (SCOPED to pure-code seams; real Mem0/Docker deferred by user 2026-07-09)
**Active Task**: S04/T03 — Mem0 adapter interface + in-memory mock (next, fresh session)
**Progress**: S03-core✅ + S04 2/5 seams (T01 store✅ T02 gate✅); suite 55/55, zero deps. S04 remaining: T03 mock adapter → T04 promotion filter → T05 recall seam
**Model Profile**: pure-anthropic (claude+codex installed; no LiteLLM/Pi needed yet)
**Last Updated**: 2026-07-09

## S03 — Router + Context Tiering (CORE COMPLETE ✅ 2026-07-09)
- 6/6 tasks built in `src/` (was empty): T01 router, T02 TOON (42%<JSON), T03 boundary guard, T04 overhead
  report, T05 YAGNI fragment, T06 agent-comms mesh. All Node ESM zero-dep (D20); `node --test` 42/42, clean exit.
- See S03-SUMMARY.md. Decisions D20–D22, KNOWLEDGE updated (node:test gate; net.Server closeAllConnections gotcha).
- Deferred pilots (Steps 3.4 rtk / 3.5 CCE / 3.6 context-mode) — tools NOT installed (D21). T03 guard already
  provides the Reference/Compressed seam they'd plug into. Revisit after tool install (user/infra decision).

## REASSESS (2026-07-09): next slice needs environment setup
- S04 (Memory) core = Mem0 (persistent Tier-2) which runs via Docker — Docker NOT installed. S03 pilots need
  rtk/CCE. Both are env-setup/user decisions. Options for next session: (a) install Docker + Mem0 and do S04;
  (b) install rtk/CCE and finish S03 pilots; (c) build pure-code S04 seams (boomerang/promotion filter) that
  don't need Mem0 yet. Recommend confirming install scope with the user before committing to (a)/(b).

## S00 — CLOSED ✅ (GO to build)
- T01 scaffold ✅ · T02 concurrency GO (10 sessions) ✅ · T03 baseline rig ✅ · T04 SKIPPED (D17 policy)
- Key: D16 lean-worker cuts ~60% cost/call. Rig ready for per-class validation on demand.

## S01 — CLOSED ✅ (substrate proven)
- herdr 0.7.3: headless socket API + `pane run → wait output → pane read` dispatch (D18). claude+codex lean
  workers, worktree-per-pane (D19), advisory locks. See panes/herdr-orchestration.md. Server runs bg.

## Installed: git, node v22.23, npm, python3 3.14 (no pip), claude 2.1.204, codex 0.143.0. Missing: wezterm, pi, rtk, docker.
