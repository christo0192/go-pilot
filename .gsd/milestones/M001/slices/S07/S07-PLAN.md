# S07: Instrumentation + Acceptance — SCOPED (pure-code, out-of-order per user 2026-07-09)

Built ahead of S05/S06 (which need Pi/Docker installs). Zero-dep Node ESM, `node --test`. Reuses
`src/router/overhead-report.mjs` (S03/T04) for router overhead. Targets = the #10 numeric acceptance.

## Shared contract (all S07 tasks use this — do not diverge)
A per-run **metrics record**:
```
{
  runId: string,
  taskClass?: string,                 // e.g. "coding", "ads-analysis" (optional)
  tokens:  { single: number, multi: number },   // single-agent baseline vs multi-pane
  quality: { single: number, multi: number },   // rubric scores (see metrics/quality-rubric.md)
  retries: { count: number, attempts: number }, // retry tracking
  routerOverheadTokens: number        // from overhead-report; NEVER netted into savings
}
```
**Acceptance targets (#10, D10):**
- token reduction ≥ 20%  →  `multi <= 0.80 * single`  → `tokenReductionPct = (single-multi)/single*100 >= 20`
- quality tolerance ≤ 5% →  `multi >= 0.95 * single`  → `qualityDropPct = (single-multi)/single*100 <= 5`
- retries: tracked/reported (no hard target, surfaced)
- router overhead: reported as its OWN line item, never subtracted from savings

## Tasks
- [x] **T01: Metrics pipeline (Step 7.1)** `src/metrics/metrics.mjs` ✅ 96/96
  `recordRun(record, opts?)` validates + appends a metrics record to `metrics/runs/*.jsonl`;
  `computeRun(record)` derives `{tokenReductionPct, qualityDropPct, retries, routerOverheadTokens}`.
  Pulls router overhead via overhead-report when a log path is given. Acceptance: a run emits a structured
  record with all four metrics. `node --test`.

- [x] **T02: Acceptance report (Step 7.2)** `src/metrics/acceptance.mjs` ✅ 115/115
  `evaluate(record|records, targets?)` → per-metric PASS/FAIL vs #10 targets + overall verdict;
  `formatReport()` markdown showing metrics vs targets. Overhead shown separate, never in savings.
  Acceptance: report renders 4 metrics against ≥20%/≤5%/retry/overhead targets. Depends on T01 contract.

- [x] **T03: Per-task-class sign-off (Step 7.3)** `src/metrics/signoff.mjs` ✅ 115/115 (live sign-off = D17 residual)
  `signoff(recordsByClass, targets?)` → per class `{class, verdict: "sign-off"|"revert-to-single", metrics}`
  using the GO rule (token≥20% AND quality≤5% drop). Real LIVE per-class data is PENDING (D17) — build the
  decision harness + test with fixtures; note live sign-off needs real runs. Depends on T01/T02 contract.
