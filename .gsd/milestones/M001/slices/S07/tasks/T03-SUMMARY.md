---
task: S07/T03
title: Per-task-class acceptance sign-off (Step 7.3)
status: complete
duration: ~8min
files_changed: [src/metrics/signoff.mjs, src/metrics/signoff.test.mjs, src/metrics/signoff.README.md]
verification: node_test_115_pass, zero_deps
---
`signoffClass(records, targets?, className?)` averages the two gating pcts (computeRun), applies the GO rule
(reduction≥20 AND drop≤5, inclusive) → `sign-off | revert-to-single` with a reason naming the failed target.
Empty records → revert, reason "no data (pending live runs — D17)" (safe default = no negative return).
`signoff(recordsByClass)` → `{results, signedOff, reverted}`, class order sorted. `formatSignoff()` table.
11 tests. Suite 115/115. LIVE per-class sign-off still needs real runs against the baseline rig (D17 residual).
