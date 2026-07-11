---
slice: S09
title: Complete Phase B (Sprint 8 deferred hardening) — buildable-now
status: complete
date: 2026-07-11
tests: 293/293 (unit 270 + integration 20 + live 3), zero deps
---

# S09 Summary — Phase B buildable-now COMPLETE

Completed every Phase B item that needs no external keys/machines/services.

## Tasks
- **T01 (8.11a)** `src/reliability/retry.mjs` — backoff/jitter, abortable withRetry, circuit breaker; injectable clock/rng/sleep. 17/17. Built by parallel agent, self-reviewed.
- **T02 (8.11b)** `src/reliability/journal.mjs` — durable IDs, crash-tolerant JSONL, idempotent dispatchOnce, reconcile. 17/17. Parallel agent, self-reviewed.
- **T03 (8.12)** `src/observability/events.mjs` — structured events, key-based redaction, inspect(runId), aggregate(dimension); reuses stats.mjs. 19/19. Parallel agent, self-reviewed.
- **T04 (8.13 follow-on)** `src/coordinator/run.mjs` — record resolved provider+version per run (best-effort). coordinator 8/8. `614c67a`.

## Commits
- `614c67a` 8.13 follow-on (resolveModel → plan.provider/version)
- `ce853ba` 8.11 reliability core (retry + journal)
- `4cea18a` 8.12 observability (events)

## Decisions / Knowledge
- D35 reliability-complements-store (at-least-once + store dedup). D36 key-based redaction limitation. See DECISIONS.md.
- Parallel-fresh-agent build pattern for independent new-dir modules; hold full suite until all land. See KNOWLEDGE.md.

## Remaining Phase B — NOT buildable now (infra/machine/key-gated)
- **8.8** live workhorse — needs Ikey API key + topped-up credits (Ikey-side).
- **8.9** benchmark campaign — needs per-class task fixtures + Max/provider quota.
- **8.14** prod security/data hardening — needs running Mem0 (auth), container/dep vuln scan, backup/restore verification.
- **8.15** clean-machine acceptance — needs clean Win/WSL/macOS boxes + a teammate.
- **8.16** controlled pilot + go-live — needs all above + a real pilot project.
- **Follow-ons (herdr-gated):** wire journal+retry+breaker into run.mjs dispatch + pane/worktree cleanup for a LIVE kill-recovery test; live alert sink for 8.12.
