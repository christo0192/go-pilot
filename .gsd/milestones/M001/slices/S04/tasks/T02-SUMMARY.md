---
task: S04/T02
title: Validation gate before compression — PLAN Step 4.2
status: complete
duration: ~10min
files_changed: [src/memory/gate.mjs, src/memory/gate.test.mjs, src/memory/gate.README.md]
verification: node_test_55_pass, zero_deps
---
Pure/deterministic gate (#6). `mustPass(result, checks)` → `{passed, failures}`; a check that throws is
itself a failure (never throws out). `gateThenCompress(result, checks, compressFn)` compresses ONLY when
all pass; on failure returns the FULL untouched result (`===` original) with `summarized:false` and does
NOT call compressFn (spy-verified call count 0) — the core acceptance: failures propagate full, never
smoothed. Check factories: `testsPass`, `scopeMatch(allowedPaths)`, `noPlaceholders()`. 7 tests. Suite 55/55.
