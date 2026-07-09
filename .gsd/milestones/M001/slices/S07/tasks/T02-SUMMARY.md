---
task: S07/T02
title: Acceptance report (Step 7.2)
status: complete
duration: ~7min
files_changed: [src/metrics/acceptance.mjs, src/metrics/acceptance.test.mjs, src/metrics/acceptance.README.md]
verification: node_test_115_pass, zero_deps
---
`evaluate(record|records, targets?)` (imports computeRun — no formula duplication) → per-metric PASS/FAIL vs
#10 targets (tokenReduction≥20 inclusive, qualityDrop≤5 inclusive) + `overallPass = token&&quality`; arrays
average the two gating pcts, sum retries+overhead, keep per-record results. `formatReport()` renders the table
+ an explicit "Router overhead (separate line item — not netted into savings)" line + OVERALL. Retries/overhead
informational only (never gate). 8 tests incl. boundary + array-average. Suite 115/115.
