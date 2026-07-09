# S04/T05 — Session-start recall seam (PLAN Step 4.5)
See S04-PLAN.md. `src/memory/recall.mjs`: `recall(adapter, context, opts)` queries the Mem0 adapter (T03)
for top-k relevant memories and returns a BOUNDED few-hundred-token injection string (cap by a token proxy).
Node ESM, zero deps. Acceptance: relevant memories are recalled + formatted within the token budget; real
cross-session vs handover comparison deferred until Docker/Mem0 exist.
