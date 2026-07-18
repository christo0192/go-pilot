# Changelog

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
