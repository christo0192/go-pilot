# S04/T01 — Boomerang + shared task store (Tier-1) (PLAN Step 4.1)
See S04-PLAN.md for scope. `src/memory/store.mjs`: file-backed store, atomic claim (O_EXCL/rename),
claim/complete/cascade + `boomerang(exchange, summarizeFn?)` collapsing an exchange to a short summary.
Acceptance: concurrent claim → one winner; complete cascades; boomerang output << input. Node ESM, zero deps, `node --test`.
