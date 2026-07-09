# Mem0 adapter — interface + in-memory mock

Tier-2 persistent memory sits behind ONE contract: `{ add, search }`.

- `add(memory)` — stores `{ id?, text, kind?, tags?, meta? }` (`text` required, non-empty)
  and returns it with an id. No id → deterministic `mem-${n}` by insertion order
  (no `Date.now`/`Math.random`). A duplicate id **upserts** (overwrites in place) and
  consumes no new insertion slot.
- `search(query, topK = 5)` — returns ≤ `topK` `{ memory, score }`, highest score first,
  tie-broken by insertion order. Empty/whitespace query or no overlap → `[]`.

`createMockMem0()` scores by deterministic keyword overlap:
`score = (distinct query tokens present in text+tags) / (distinct query tokens)`.
No LLM, no embeddings, no I/O — reproducible across fresh mocks fed the same sequence.

The real Docker **Mem0** client (Step 4.3, deferred until Docker is installed) drops in
behind this exact `{ add, search }` interface, so callers need no changes.
