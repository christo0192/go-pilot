# promotion.mjs — Tier-1 → Mem0 promotion filter (PLAN 4.4)

`promote(candidates, adapter, opts)` distills ONLY validated keepers into Tier-2 at run end.
A candidate is promoted IFF it BOTH (a) passes its validation gate — `mustPass(memory, checks).passed`
(reused from `gate.mjs`) — AND (b) has a KEEPER `kind` (default `decision | summary | pref`,
override via `opts.keeperKinds`). Missing/non-keeper kinds (e.g. `scratch`, `debug`) are dropped.
Promoted memories are persisted via `adapter.add` (the `mem0-adapter.mjs` `{add, search}` contract).
Returns `{ promoted: [...added memories], skipped: [{ memory, reason }] }`, reason ∈ `failed-gate` | `non-keeper-kind`.
Failed results (bad facts) and non-keeper scratch NEVER reach Tier-2 — this is the anti-bloat / anti-contamination
boundary (D6). Pure aside from `adapter.add`; deterministic, order-preserving, inputs never mutated.
