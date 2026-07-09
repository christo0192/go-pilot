---
task: S07/T01
title: Metrics pipeline (Step 7.1)
status: complete
duration: ~8min
files_changed: [src/metrics/metrics.mjs, src/metrics/metrics.test.mjs, src/metrics/metrics.README.md]
verification: node_test_96_pass, zero_deps
---
Per-run metrics contract established. `validateRecord` (never throws → {valid,errors}); `computeRun` →
`{tokenReductionPct=(single-multi)/single*100, qualityDropPct, retries, routerOverheadTokens}` (unrounded,
not clamped — negative reduction preserved); `recordRun` validates-then-appends JSONL (bad record throws,
never written); `withRouterOverhead` pulls overhead from src/router/overhead-report.mjs (non-mutating).
Router overhead kept as its OWN field, never netted into savings (asserted). 16 tests. Suite 96/96.
