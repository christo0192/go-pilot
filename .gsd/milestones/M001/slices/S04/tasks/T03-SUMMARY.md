---
task: S04/T03
title: Mem0 adapter interface + in-memory mock (Step 4.3 deferred → mock)
status: complete
duration: ~8min
files_changed: [src/memory/mem0-adapter.mjs, src/memory/mem0-adapter.test.mjs, src/memory/mem0-adapter.README.md]
verification: node_test_65_pass, zero_deps
---
Stable `{ add(memory), search(query, topK=5) }` contract + `createMockMem0()` deterministic in-memory impl.
Relevance = distinct-query-token overlap over text+tags, normalized to (0,1]; sort desc, tie-break by
insertion order; no-overlap/empty query → []. Auto-id `mem-${count}` (reproducible, no Date/random); explicit
id honored; duplicate id = UPSERT (keeps slot, doesn't consume an index). The real Docker Mem0 client (Step
4.3, deferred D21) drops in behind this same contract — the only coupling point. 10 tests. Suite 65/65.
