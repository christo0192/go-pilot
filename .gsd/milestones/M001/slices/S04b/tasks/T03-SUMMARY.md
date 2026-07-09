---
task: S04b/T03
title: Wire real Mem0 as default Tier-2 (factory + live integration test)
status: complete
duration: ~10min
files_changed: [src/memory/tier2.mjs, src/memory/tier2.test.mjs, src/memory/pipeline.integration.test.mjs, src/memory/tier2.README.md]
verification: node_test_135_pass, live_integration_ran
---
`createTier2Adapter({mode:auto|mock|mem0, baseUrl?, userId?})` selects mock vs real mem0-client by config
(auto → real when MEM0_BASE_URL/baseUrl resolvable, else mock). `isMem0Up(baseUrl)` liveness probe (2s
timeout GET /docs). 6 unit tests (selection, no network). LIVE self-skipping integration test: gate → promote
→ mem0-client → recall against running Mem0; keeper retrieved (score 0.35), gated scratch note absent.
FINDING (→ T04): promote/recall were only sync-adapter-safe → fixed in T04. Suite 135/135, integration RAN.
