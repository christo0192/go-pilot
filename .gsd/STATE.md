# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S04 — Memory — PURE-CODE SEAMS COMPLETE ✅ (real Mem0/Docker deferred by user)
**Active Task**: S05/T01 — workflow skills (brainstorm→…→auto) — next slice (see Reassess)
**Progress**: S00✅ S01✅ S03-core✅ S04-seams✅ (S02 skipped) · S04 5/5 seams, suite 80/80, zero deps · Overall PLAN 55%
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

## REASSESS (2026-07-09): remaining M001 work = env-setup or workflow-layer
- DEFERRED on installs (user decision): S03 pilots (rtk/CCE), S04 real Mem0 (Docker/Step 4.3).
- BUILDABLE without installs: S05 (workflow skills brainstorm→…→auto; Phase-0 alignment gate) — but S05 is a
  Pi/skills UX layer (D-model); some depends on Pi installed. S07 instrumentation partly pure-code.
- S06 (self-installing repo install.sh/.ps1 + compose) needs the deferred services to exist to be meaningful.
- NEXT-SESSION OPTIONS: (a) install Docker+Mem0 → wire real adapter behind D23 contract + finish S04; (b) install
  rtk/CCE → S03 pilots; (c) S05 workflow-skills groundwork that doesn't need Pi; (d) S07 metrics/acceptance seams.
  Recommend surfacing the install-scope decision to the user before S05/S06.

## S00 — CLOSED ✅ (GO to build)
- T01 scaffold ✅ · T02 concurrency GO (10 sessions) ✅ · T03 baseline rig ✅ · T04 SKIPPED (D17 policy)
- Key: D16 lean-worker cuts ~60% cost/call. Rig ready for per-class validation on demand.

## S01 — CLOSED ✅ (substrate proven)
- herdr 0.7.3: headless socket API + `pane run → wait output → pane read` dispatch (D18). claude+codex lean
  workers, worktree-per-pane (D19), advisory locks. See panes/herdr-orchestration.md. Server runs bg.

## Installed: git, node v22.23, npm, python3 3.14 (no pip), claude 2.1.204, codex 0.143.0. Missing: wezterm, pi, rtk, docker.
