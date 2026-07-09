# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S07 — Instrumentation + Acceptance COMPLETE ✅ (built ahead of S05/S06, pure-code)
**Active Task**: — (reassess: all remaining M001 work needs installs — see Reassess)
**Progress**: S00✅ S01✅ S03-core✅ S04-seams✅ S07✅ (S02 skipped) · suite 115/115, zero deps · Overall PLAN 62%
**Model Profile**: pure-anthropic (claude+codex installed; no LiteLLM/Pi needed yet)
**Last Updated**: 2026-07-09

## S03 — Router + Context Tiering (CORE COMPLETE ✅ 2026-07-09)
- 6/6 tasks built in `src/` (was empty): T01 router, T02 TOON (42%<JSON), T03 boundary guard, T04 overhead
  report, T05 YAGNI fragment, T06 agent-comms mesh. All Node ESM zero-dep (D20); `node --test` 42/42, clean exit.
- See S03-SUMMARY.md. Decisions D20–D22, KNOWLEDGE updated (node:test gate; net.Server closeAllConnections gotcha).
- Deferred pilots (Steps 3.4 rtk / 3.5 CCE / 3.6 context-mode) — tools NOT installed (D21). T03 guard already
  provides the Reference/Compressed seam they'd plug into. Revisit after tool install (user/infra decision).

## S04 — Memory PURE-CODE SEAMS COMPLETE ✅ 2026-07-09
- 5/5 in src/memory/: store (Tier-1 atomic claim+boomerang), gate (validate-before-compress), mem0-adapter
  (mock {add,search}), promotion (keepers-only), recall (bounded session-start injection). See S04-SUMMARY.md.
  Pipeline: store→gate→promotion→adapter→recall. Decisions D23. suite 80/80, zero deps, 28 serial runs 0 flakes.

## S07 — Instrumentation + Acceptance COMPLETE ✅ 2026-07-09
- src/metrics/: metrics (per-run record + computeRun), acceptance (evaluate vs #10 targets ≥20%/≤5%),
  signoff (per-class GO vs revert; no-data→revert, D17 safe default). 115/115, zero deps. See S07-SUMMARY.md.
- Residual: LIVE per-class sign-off needs real baseline-rig runs fed into signoff() (D17).

## REASSESS (2026-07-09): all remaining M001 work needs installs / deferred services
Pure-code buildable-now work is EXHAUSTED. Remaining:
- S05 (Pi workflow skills brainstorm→…→auto + Phase-0 gate) — needs Pi installed (`npm i -g @earendil-works/pi-coding-agent`).
- S06 (self-installing repo install.sh/.ps1 + docker compose) — needs the deferred services to exist to be meaningful.
- Env-deferred: S03 pilots (rtk/CCE), S04 real Mem0 (Docker), S07 live per-class sign-off (baseline runs).
NEXT-SESSION OPTIONS (all need a user install decision): (a) install Docker → wire real Mem0 behind D23 +
run live acceptance/sign-off; (b) install Pi → S05 skills; (c) install rtk/CCE → S03 pilots; (d) start S06
install scripts (can scaffold idempotent installers now, but end-to-end verify needs the services).

## S00 — CLOSED ✅ (GO to build)
- T01 scaffold ✅ · T02 concurrency GO (10 sessions) ✅ · T03 baseline rig ✅ · T04 SKIPPED (D17 policy)
- Key: D16 lean-worker cuts ~60% cost/call. Rig ready for per-class validation on demand.

## S01 — CLOSED ✅ (substrate proven)
- herdr 0.7.3: headless socket API + `pane run → wait output → pane read` dispatch (D18). claude+codex lean
  workers, worktree-per-pane (D19), advisory locks. See panes/herdr-orchestration.md. Server runs bg.

## Installed: git, node v22.23, npm, python3 3.14 (no pip), claude 2.1.204, codex 0.143.0. Missing: wezterm, pi, rtk, docker.
