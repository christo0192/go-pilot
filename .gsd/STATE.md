# GSD State

**S13 path-to-9 execution (2026-07-13, autonomous)**: P1✅ (CI green: unit matrix ubuntu/macos/windows + integration + zero-deps gate + shellcheck + gitleaks; GitHub secret-scanning/push-protection/branch-protection; SECURITY.md; src/validation + src/router/risk classifiers wired into CLAUDE.md; key-echo test; rotation SKIPPED per user — keys kept for testing). P2✅ (breaker/budget/journal in pi-delegate; agentic token accounting via Pi session logs — usage no longer null; --sandbox worktree isolation live-verified; 8 fault-injection tests). P3✅ (5 zero-dep modules: templates ≤10% scaffold, extraction w/ evidence verification, spreadsheet preprocessor, evidence packs, session compression). P4 build✅ (Opus-only headline judge + adjudication queue; failed attempts cost money; v3 reliability-adjusted metrics + §11 gates; B2 lean-Opus DERIVED analytically — measured CLI tax 50,050 cacheWrite + 15,166 cacheRead ≈ $0.508/call, calibration.json). P4 trim RUNNING (114 runs = 38 fixtures × A/B/C × 1 trial, --repair, seed 20260713, CAMPAIGN_OUT=scripts/baseline-rig/out-v3-trim, checkpointed — resume = rerun same command). P5 mostly✅ (gopilot-status.mjs live; install.sh --doctor 12/13 + CI clean-machine job; Pi pinned 0.80.6; CHANGELOG + RUNBOOK; v1.0.0 tag pending benchmark). Windows CI flake fixed (workspace test made hermetic). NEXT: trim completes → grade (Opus-only) → aggregate → §11 gate decision → conditional full v3 (5 arms incl. D multi-turn, +fixtures, 3 trials) → results doc → tag v1.0.0 → report to user and WAIT.

**S12 PUBLISHED to GitHub (2026-07-13)**: remote = https://github.com/christo0192/go-pilot (PUBLIC, default branch `main`, local branch renamed master→main). Full history REWRITTEN via git-filter-repo: all 59 commits re-identified as Chris <christo.b@interviewkickstart.com>, india.sales scrubbed from every blob; pre-rewrite backup bundle in the session job tmp dir (ephemeral). Secret audit of all history: clean (only fake test keys + placeholders). Plug-and-play: `install.sh ensure_orchestrator()` (pi-delegate shim, Pi provider templated via __GOPILOT_REPO__, global skill from deploy/global-skill.gopilot-orchestrate.md), `WORKHORSE_GATEWAY_KEY` added to deploy/.env.example (the one key a user fills), README quickstart = clone → install → key → claude. NOTE: repo commits now use christo.b identity (git config local).

**S11 orchestrator framework LIVE (2026-07-13)**: production daily-driver flow shipped — repo-root `CLAUDE.md` (Claude Code = Opus orchestrator: risk-classify → route → delegate → verify → repair → assemble; hybrid writing policy w/ `workhorse-only` opt-out; billing invariants) + `.claude/skills/{orchestrate,pi-workers,herdr-panes}` + hardened `scripts/pi-delegate.sh` (flags `--raw/--repair/--class/--timeout/--max-tokens`, JSONL metrics ledger → `scripts/baseline-rig/out/delegate-log.jsonl`, exit codes 0/2/3/4/5, mechanical repair strict→sibling) + `scripts/gateway-call.mjs` (non-agentic worker, exact usage incl. reasoning tokens). All live-tested (raw both models, agentic pane w/ zero leak, forced repair ladder). DEFERRED by user decision: benchmark v3 rerun, extraction/spreadsheet/retrieval pipelines, multi-turn compression (Codex upgrade plan §3-5,§7,§10-11 — planned, not built).

**Phase**: executing
**Active Milestone**: M001 — Go-pilot build (PLAN.md sprints 0–7)
**Active Slice**: S10 — Live-runtime foundation (Codex-built, then reviewed+fixed+committed). Integrates dispatch adapters, retrieval, prompt/cache builder, rules discovery, workspace checkpoints, execution contracts into run.mjs.
**Active Task**: — S10 landed. Remaining Sprint 8 work still user/infra/machine-gated: 8.8 (Ikey key+credits — needed to actually RUN the new live adapters), 8.9 (fixtures+quota), 8.14 (Mem0 services+vuln scan+backup), 8.15 (clean boxes), 8.16 (pilot).
**Progress**: S00–S07✅ · S08 Phase A 8.1–8.7✅ · Phase B 8.10/8.11/8.12/8.13✅ · S10 live-runtime foundation✅ (dispatch/context/prompts/instructions/runtime/benchmarks modules + rebuilt run.mjs) · 310/310 (unit 287 + integration 20 + live 3), zero deps · HEAD (S10 commit)
**S10 review (2026-07-12)**: Codex built the foundation but 2 tests failed (rg is a shell function → spawnSync ENOENT → silent-empty retrieval). Fixed: retrieval degrade-safe (node-fs fallback) + re-hermeticized lifecycle test. Security Engineer + Code Reviewer passes → fixed HIGH candidate-race Promise.all→allSettled, output-cap DoS, `--`/model-validation flag-injection, secret redaction in errors, breaker isolation, durability reconcile, captureWorkspace opt-out. Committed `e698961`.
**D37 candidate-race governance (2026-07-12, user decision)**: candidate-race is NOT gated by the efficiency sign-off (it makes no efficiency claim — it trades tokens for reliability). Instead `contracts.mjs` codifies the mode taxonomy (`modeGovernance`: efficiencyGated vs costOptIn) and cost-opt-in modes require explicit `allowParallelCost` (CLI `--allow-parallel-cost`) on a LIVE run + optional `contract.maxCostUsd` cap. Fixed `downgraded` mislabel (now `execution !== requestedMode`). 313/313.
**Workhorse gateway = Ikey (D34)**: user's own hosted LiteLLM (https://ikey-gateway.fly.dev), one key, no OpenRouter markup. Live worker (8.8) needs the Ikey key + credits topped up (Ikey-side). Local LiteLLM now behind a compose profile.
**Remaining**: Phase A 8.6/8.7 (buildable now) · 8.8 live workhorse (Ikey key+credits) · 8.9 benchmark (fixtures+quota) · Phase B 8.10–8.16 deferred · SECURITY: rotate exposed OpenAI key.
**Test buckets (8.3)**: `npm run test:unit` (hermetic, no ports/tools) · `test:integration` (loopback fakes: mesh, mem0-client) · `test:live` (needs real cce/rtk/Mem0, self-skips). Bucketer = `scripts/run-tests.mjs`, filename-suffix convention `.integration.test.mjs`/`.live.test.mjs`.
**SCOPE (D31)**: hybrid is first-class — rig must serve anthropic-only / codex-only / hybrid / open-first users. S02 builds the workhorse plane (also fixes the per-worker 44k Claude Code overhead — Pi/open-model panes carry none).
**Installed this session**: Docker (native WSL2), Pi 0.80.6, rtk 0.43.0, CCE 0.4.25, uv. Mem0 LIVE. NEEDS: ≥1 open-model key (OpenRouter recommended) for LiteLLM.
**Model Profile**: pure-anthropic (claude+codex installed; no LiteLLM/Pi needed yet)
**Last Updated**: 2026-07-11

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
