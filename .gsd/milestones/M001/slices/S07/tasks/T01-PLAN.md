# S07/T01 — Metrics pipeline (PLAN Step 7.1)
See S07-PLAN.md for the shared metrics-record contract. `src/metrics/metrics.mjs`: `recordRun` (validate +
append JSONL to metrics/runs/) + `computeRun` (derive tokenReductionPct, qualityDropPct, retries,
routerOverheadTokens). Reuse src/router/overhead-report.mjs for overhead. Node ESM, zero deps, `node --test`.
Acceptance: a run emits a structured record with all four metrics; malformed record rejected.
