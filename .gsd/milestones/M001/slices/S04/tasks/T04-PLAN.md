# S04/T04 — Promotion filter (Tier-1 → Mem0) (PLAN Step 4.4)
See S04-PLAN.md. `src/memory/promotion.mjs`: at run-end, distill ONLY validated keepers into the Mem0
adapter (T03). A candidate is promoted iff it passes the S04/T02 gate (`src/memory/gate.mjs`) AND is a
keeper kind (decision/summary/pref) — failed/scratch/non-keeper items are excluded. Node ESM, zero deps.
Acceptance: after promotion, the adapter contains only validated keepers; failed + non-keeper items absent.
