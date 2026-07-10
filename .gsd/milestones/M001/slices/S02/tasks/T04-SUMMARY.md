---
task: S02/T04
title: Tool-call schema validator + repair loop + Pi extension (Step 2.4)
status: complete (before/after reliability measurement deferred — needs flaky-model key)
files_changed: [src/toolcall/repair.mjs, src/toolcall/repair.test.mjs, config/toolcall-schemas.json, .pi/extensions/tool-call-repair.ts, docs/workhorse-plane.md]
verification: node_test_172, pi_loads_extension_headless, zero_deps
---
Core `src/toolcall/repair.mjs` (zero-dep, tested): `validateToolCall(call, schema)` (required/type/unknown-field
checks, precise errors), `buildRepairPrompt`, `runRepairLoop({call,schema,reCall,maxRetries=2})` with INJECTED
reCall (testable, no model). 16 tests (valid / missing / wrong-type / multi-error / repair-on-retry / exhausted).
Pi extension `.pi/extensions/tool-call-repair.ts` hooks the `tool_call` event, IMPORTS the .mjs core via Pi's jiti
(single source of truth — no mirror), blocks invalid calls with the repair prompt (Pi's turn loop re-prompts),
bounded 2 retries then fails open. Pi loads it headlessly (get_commands → toolcall-schemas). Before/after tool-call
success-rate on a real flaky open model DEFERRED (needs OPENROUTER_API_KEY) — not faked.
