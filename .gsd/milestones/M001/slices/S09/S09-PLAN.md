# S09: Complete Phase B (Sprint 8 deferred hardening)

Buildable-now Phase B. Hermetic, zero-dep. 8.14 (Mem0-auth/vuln-scan — needs
services), 8.15 (clean-machine — needs machines/teammate), 8.16 (pilot — needs
all + real pilot) remain infra/machine-gated and are NOT in scope here.

## Tasks
- [x] **T01: 8.11a — retry/backoff/circuit-breaker** `src/reliability/retry.mjs` ✅ ce853ba (17/17)
- [x] **T02: 8.11b — durable IDs + journal + idempotency + reconcile** `src/reliability/journal.mjs` ✅ ce853ba (17/17)
- [x] **T03: 8.12 — observability (events + redaction + inspect + aggregate)** `src/observability/events.mjs` ✅ 4cea18a (19/19)
- [x] **T04: 8.13 follow-on — wire resolveModel into run.mjs** ✅ 614c67a (plan.provider+version, best-effort; coordinator 8/8)

## Verification (per task)
`timeout 100 node --test` green, zero deps, flake-check any timing tests 5x, code-review, commit.
