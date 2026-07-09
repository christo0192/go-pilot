---
task: S04/T01
title: Boomerang + shared task store (Tier-1) — PLAN Step 4.1
status: complete
duration: ~10min
files_changed: [src/memory/store.mjs, src/memory/store.test.mjs, src/memory/store.README.md]
verification: node_test_55_pass, clean_exit, zero_deps
---
`createStore(rootDir)` file-backed store. ATOMIC claim via `fs.openSync(claimPath,'wx')` (O_EXCL) →
exactly one winner across concurrent/cross-process claimers; losers get EEXIST → null, never throw.
`deps[]` + `ready()`/`cascade()` model dependency unblocking on complete. `boomerang(exchange, summarizeFn?)`
deterministically collapses an exchange (keeps DECISION/RESULT lines + final line, cap 280 chars); real
summarizer injectable later. IDs `encodeURIComponent`-encoded (path-traversal safe). 6 tests incl. the
concurrent-claim race. Suite 55/55, zero deps.
