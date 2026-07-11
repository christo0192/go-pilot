# GSD State

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S08 Production Readiness — Phase A 4/9 done (integrated control plane building out)
**Active Task**: — remaining Phase A = 8.3 test-split, 8.6 store state-machine, 8.7 token-aware boundary (all buildable now)
**Progress**: S00–S07 build✅ · S08 Phase A: 8.1 coordinator✅ 8.2 e2e✅ 8.4 metrics-accounting✅ 8.5 deploy-hardening✅ · unit 198/198, zero deps · HEAD eaa80f7
**Workhorse gateway = Ikey (D34)**: user's own hosted LiteLLM (https://ikey-gateway.fly.dev), one key, no OpenRouter markup. Live worker (8.8) needs the Ikey key + credits topped up (Ikey-side). Local LiteLLM now behind a compose profile.
**Remaining**: Phase A 8.3/8.6/8.7 (buildable now) · 8.8 live workhorse (Ikey key+credits) · 8.9 benchmark (fixtures+quota) · Phase B 8.10–8.16 deferred · SECURITY: rotate exposed OpenAI key.
**SCOPE (D31)**: hybrid is first-class — rig must serve anthropic-only / codex-only / hybrid / open-first users. S02 builds the workhorse plane (also fixes the per-worker 44k Claude Code overhead — Pi/open-model panes carry none).
**Installed this session**: Docker (native WSL2), Pi 0.80.6, rtk 0.43.0, CCE 0.4.25, uv. Mem0 LIVE. NEEDS: ≥1 open-model key (OpenRouter recommended) for LiteLLM.
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

## S06 — Self-installing repo ✅ 2026-07-09
- install.sh (mac/WSL) LIVE-verified idempotent no-op (exit 0, Mem0 200) — Step 6.1 done-when met. install.ps1
  authored (Windows parity; live run = 6.5). docs/INSTALL.md both OSes + revert. 6.3 compose ✅, 6.4 templating ✅.
- Remaining S06: only 6.5 fresh-machine Win+Mac acceptance (needs clean boxes + teammate). Decisions D27.

## M001 near-complete (94%) — final 2 items are USER-GATED (2026-07-10)
- **Live per-class sign-off (D17)**: harness READY (scripts/baseline-rig/run.py, herdr 0.7.3 running,
  metrics/quality-rubric.md, src/metrics/signoff.mjs). BUT needs: real per-class task fixtures (only
  tasks/trivial-smoke.json exists), real Claude/Codex runs (Max quota), and subjective quality scoring. This is
  exactly the T04 the user DEFERRED (D17). To finish: add fixtures for the 5 classes → run run.py single vs
  multi → score per rubric → feed records to signoff(). User decision (quota + fixtures + judging).
- **S06/6.5 fresh-machine verify**: run install.ps1 on a clean Windows box + install.sh on a clean mac (teammate
  acceptance). Can't be done from this WSL box.
- Everything else (S00–S07 core, real Mem0 live, Pi skills, installers, rtk/CCE) is DONE + committed.
- SECURITY still open: rotate the OpenAI key pasted in chat (gitignored deploy/.env; safe from git).

## S04b Tier-2 wiring COMPLETE ✅ 2026-07-09 (the "no-install win" — now done)
- src/memory/tier2.mjs createTier2Adapter({mode:auto|mock|mem0}); promote/recall made async → work with the
  async real mem0-client AND sync mock. Live integration test proves gate→promote→mem0→recall. Memory = DONE.
  Decisions D28. Suite 135/135. To use real Mem0 in orchestrator code: createTier2Adapter({mode:'mem0'}).

## REASSESS (2026-07-09, post-Tier2-wiring): remaining M001 is ALL install-gated / other-machine
- S05 (Pi workflow skills brainstorm→…→auto + Phase-0 gate) — needs Pi (`npm i -g @earendil-works/pi-coding-agent`).
- S03 pilots (3.4 rtk / 3.5 CCE / 3.6 context-mode) — need rtk + CCE installed.
- Live per-class sign-off (D17) — needs real baseline-rig runs to feed src/metrics/signoff.mjs.
- S06/6.5 fresh-machine Win+Mac verify — needs clean boxes + a teammate.
- No buildable-now-without-install work remains. Next session: pick an install path with the user.

## (earlier reassess note, superseded)
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
