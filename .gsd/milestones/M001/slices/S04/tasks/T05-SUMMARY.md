---
task: S04/T05
title: Session-start recall seam — PLAN Step 4.5
status: complete
duration: ~10min
files_changed: [src/memory/recall.mjs, src/memory/recall.test.mjs, src/memory/recall.README.md]
verification: node_test_80_pass, zero_deps
---
`recall(adapter, context, opts)` derives a query from context (string | string[] | {query}), calls
`adapter.search(query, topK=5)`, and formats a BOUNDED injection ("## Recalled context" + `- [kind] text`
bullets, rank order). Token budget `opts.maxTokens=300` via proxy chars/4: compares char length vs
maxTokens*4 (exact); drops whole later bullets that overflow; truncates only the top bullet with `…` if it
alone overflows; final slice safety net → `tokens <= maxTokens` ALWAYS. No hits → `{text:"",used:[],tokens:0}`.
7 tests incl. tiny-budget drop + long-memory truncate. Suite 80/80. Real cross-session vs handover comparison
deferred until Docker/Mem0 (Step 4.5 residual).
