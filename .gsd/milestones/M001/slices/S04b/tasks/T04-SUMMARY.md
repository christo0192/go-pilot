---
task: S04b/T04
title: Make promote/recall async-adapter-safe (real Mem0 usable in pipeline)
status: complete
duration: ~8min
files_changed: [src/memory/promotion.mjs, src/memory/recall.mjs, src/memory/promotion.test.mjs, src/memory/recall.test.mjs, src/memory/pipeline.integration.test.mjs]
verification: node_test_135_pass_3x, live_integration_ran, mock_path_unchanged
---
`promote` and `recall` are now `async` and `await adapter.add/search`, so they work with the async real
mem0-client AND the sync mock (await on a non-Promise is a no-op → mock behavior identical, all prior unit
tests pass with only async/await sugar). Integration test simplified to use `await promote`/`await recall`
directly against live Mem0 — recalled the keeper ("...routes code tasks to the sonnet model...") and excluded
the failed-gate scratch note. This closes the real gap: real Mem0 is now genuinely usable as default Tier-2
(callers must await). 135/135 across 3 live runs, zero deps, clean exit.
