# Changelog

## Unreleased — post-1.0.0

Hardening + empirical validation on top of the tagged release.

### Model routing (benchmark-driven)
- **Kimi K2.5** replaces K2.6 for document-QA and extraction: doc-QA 3-trial confirmed (97.1,
  beats DeepSeek every fixture); extraction schema-validated in a pre-registered production-gate
  run (90.0, clears ≥90 — the strict-schema regression is gone). K2.6 retired from active routing
  (alias kept for reproducibility); Kimi K3 evaluated and rejected (~$15/M).
  Docs: `docs/live-test-results-v3-{deepseek,trim,k25-extraction,prodgate}.md`.
- `ikey-prod` wired K2.5 → DeepSeek fallback on schema/citation failure; all attempts accounted.

### Live coordinator path
- Fixed `scripts/pi-gopilot.sh` — a stale placeholder forced `--provider openai` on gateway ids
  and the coordinator's live workhorse dispatch had never worked. Now uses the registered `ikey`
  provider; `gopilot run` dispatches through a real Pi agent end-to-end.
- Fixed live token-usage recovery: an escaped-newline snippet mismatch made `pi-usage.mjs`
  silently return null, so cost accounting was blind on live runs. Now recovers real tokens + cost.
- Fixed the benchmark dispatcher to accept the pinned version `run.mjs` now passes.

### Ops / CI
- `install.ps1 -Doctor` verify-only mode + a clean-Windows CI installer-doctor job — clean-machine
  install is now CI-verified on ubuntu, macOS, and Windows.
- `check:routing` / `check:metrics` made clean-checkout- and Windows-safe; `check:metrics` skips
  cleanly when the (gitignored) benchmark ledgers aren't present.
- Multi-agent efficiency sign-off assessed (D39): reverts to single-agent (safe default).

## v1.0.0 — 2026-07-18

First tagged release: the production orchestration rig, hardened and measured.

### Orchestration (the daily driver)
- Repo `CLAUDE.md` turns Claude Code into the orchestrator: risk-classified routing
  (deterministic classifier + logged overrides), delegation to Kimi/DeepSeek via
  `pi-delegate`, deterministic verification, escalation ladder, hybrid writing policy
  (`workhorse-only` opt-out). Works from ANY repo (global skill + PATH shim;
  agentic workers run in the caller's cwd).
- Governed primitive: circuit breaker, settled-spend budget guard, orchestration
  journal, `--sandbox` git-worktree isolation for repo edits, exact token accounting
  for BOTH raw and agentic workers (Pi session-log recovery).

### Efficiency modules (Codex §3–§7)
- Compact task templates with scaffold-budget accounting (≤10% scaffold).
- Schema-first extraction with per-field evidence verification.
- Deterministic spreadsheet preprocessor (raw data never reaches the model).
- Evidence-pack retrieval with chunk-id citations.
- Multi-turn session-state compression (≥50% reduction, consistency-checked).

### Benchmark v3 + model routing (evidence-based)
- Honest accounting (failed attempts cost money), Opus-only headline judge,
  adjudication queue, reliability-adjusted metrics, analytic lean-Opus baseline
  (measured Claude-Code session tax: ~65k tokens ≈ $0.51/call).
- **Honest outcome:** the pre-registered §11 gates (go-pilot cheaper *and* at
  quality parity with Opus across the board) did NOT pass — the blanket
  "beats-Opus-everywhere" claim was too strong. What the benchmark *did* produce
  is a validated **per-task-type routing policy**, which is the real deliverable.
- **Workhorse routing (`config/router.json` `ikey-prod`):** DeepSeek V4 Pro is the
  default workhorse (cheapest, most reliable); **Kimi K2.5** for document-QA
  (confirmed 3-trial: median 97.1, beats DeepSeek every fixture) and extraction
  (average win +2.2, kept as a validated-candidate); analysis / spreadsheet /
  creative → DeepSeek; Opus for orchestration + high-risk escalation. Kimi K2.6
  retired (K2.5 strictly dominates it); Kimi K3 evaluated and rejected (~$15/M,
  at/above lean-Opus cost).
- Result docs: `docs/live-test-results-v3-{trim,deepseek,k25-extraction}.md`
  (`-hybrid` = a shelved experiment, see `.gsd/DECISIONS.md` D38).

### Security & production
- Full-history secret audit + PII scrub; GitHub secret scanning, push protection,
  branch protection; SECURITY.md; key-echo hygiene test.
- CI: unit matrix (ubuntu/macos/windows), integration, zero-deps gate, shellcheck,
  gitleaks full-history, clean-machine installer doctor.
- `scripts/gopilot-status.mjs` single pane of glass; `install.sh --doctor`;
  pinned Pi version; plug-and-play install (one key: `WORKHORSE_GATEWAY_KEY`).

Suite: 440+ tests, zero runtime dependencies.
