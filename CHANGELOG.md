# Changelog

## v1.0.0 — 2026-07-13

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

### Benchmark v3
- Honest accounting (failed attempts cost money), Opus-only headline judge,
  adjudication queue, reliability-adjusted metrics, analytic lean-Opus baseline
  (measured Claude-Code session tax: ~65k tokens ≈ $0.51/call).
- Results: `docs/live-test-results-v3.md`.

### Security & production
- Full-history secret audit + PII scrub; GitHub secret scanning, push protection,
  branch protection; SECURITY.md; key-echo hygiene test.
- CI: unit matrix (ubuntu/macos/windows), integration, zero-deps gate, shellcheck,
  gitleaks full-history, clean-machine installer doctor.
- `scripts/gopilot-status.mjs` single pane of glass; `install.sh --doctor`;
  pinned Pi version; plug-and-play install (one key: `WORKHORSE_GATEWAY_KEY`).

Suite: 440+ tests, zero runtime dependencies.
