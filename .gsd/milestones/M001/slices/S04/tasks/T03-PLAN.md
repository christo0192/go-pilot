# S04/T03 — Mem0 adapter interface + in-memory mock (replaces Step 4.3 for now)
See S04-PLAN.md. `src/memory/mem0-adapter.mjs`: a stable `{ add(memory), search(query, topK) }` interface
+ a deterministic in-memory MOCK impl (keyword/substring relevance, stable tie-break). The real Docker
Mem0 client implements the SAME interface later (D21). Node ESM, zero deps, `node --test`.
Acceptance: add then search returns the relevant memory ranked first; topK bounds results; unknown query → [].
