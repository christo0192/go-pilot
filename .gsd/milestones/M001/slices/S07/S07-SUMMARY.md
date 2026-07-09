# S07 — Instrumentation + Acceptance — SLICE SUMMARY (pure-code complete)

**Status:** all 3 tasks COMPLETE (T01–T03). Built out-of-order (ahead of S05/S06) per user choice — pure-code,
no installs. LIVE per-class sign-off needs real baseline runs (D17 residual).
**Verification:** `node --test` → **115/115 pass**, 5 clean serial runs, **zero external dependencies**.
**Date:** 2026-07-09

## What was accomplished — the #10 numeric-acceptance harness, in `src/metrics/`
| Task | PLAN | Module | What it does |
|---|---|---|---|
| T01 | 7.1 | `metrics.mjs` | Per-run metrics record: validate + append JSONL; `computeRun` → tokenReductionPct, qualityDropPct, retries, routerOverheadTokens (overhead kept separate, never netted). Reuses overhead-report (S03/T04). |
| T02 | 7.2 | `acceptance.mjs` | `evaluate` per-metric PASS/FAIL vs #10 targets (≥20% reduction, ≤5% drop) + overall; `formatReport` with overhead as its own line. |
| T03 | 7.3 | `signoff.mjs` | Per-class GO decision: sign-off vs revert-to-single; no-live-data → revert (D17 safe default). |

Together these implement the #10 acceptance gate (D10): ≥20% token reduction, ≤5% quality drop, retries tracked,
router overhead reported separately. All metrics flow from one shared record contract (defined in T01).

## Files changed
`src/metrics/{metrics,acceptance,signoff}.mjs` (+ `.test.mjs` + `.README.md` each).

## Residual (needs real runs — not a code gap)
- **Live per-class sign-off (7.3):** the decision harness is done + fixture-tested, but signing off actual GO
  classes needs live multi-pane-vs-baseline runs via `scripts/baseline-rig` — the same D17 measurement that was
  deferred. When those runs happen, feed the metrics records straight into `signoff()`.

## Decisions/Lessons
- Reused the parallel-agent race mitigation from S04: each concurrent agent tested ONLY its own file
  (`node --test <file>`), orchestrator ran the full suite serially → clean 115/115, no false flakes. (→ KNOWLEDGE)

## Milestone status after S07
M001 now: S00✅ S01✅ S03-core✅ S04-seams✅ S07✅ (S02 skipped). Remaining: S05 (Pi workflow skills),
S06 (self-installing repo), + the env-deferred items (S03 pilots rtk/CCE, S04 real Mem0/Docker, live sign-off).
All remaining work needs installs (Pi/Docker/rtk/CCE) or the deferred services — a user/infra decision.
