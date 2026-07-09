# Tier-2 adapter selector (`tier2.mjs`)

`createTier2Adapter(opts)` is a thin factory that picks the Tier-2 (persistent)
memory backend from config. Both backends implement the same `{ add, search }`
contract, so nothing downstream changes.

- `mode: "mock"` → `createMockMem0()` — deterministic, in-memory, no network.
- `mode: "mem0"` → `createMem0Client()` — real HTTP Mem0. `baseUrl` resolves
  `opts.baseUrl ?? MEM0_BASE_URL ?? http://localhost:8888`; an explicit blank
  baseUrl is unresolvable and throws.
- `mode: "auto"` (default) → real client **iff** a baseUrl is explicitly
  configured (`opts.baseUrl` or `MEM0_BASE_URL`), else the mock. So real Mem0 is
  the default Tier-2 whenever `MEM0_BASE_URL` is set.

`isMem0Up(baseUrl?)` is a 2s-timeout `GET /docs` liveness probe (true iff HTTP
200); the integration test uses it to self-skip when Mem0 is down.

Because `promotion.mjs` and `recall.mjs` already accept any `{ add, search }`
adapter, wiring the real store needs **no other code changes** — just this
factory. Caveat: those two modules are **synchronous** (their unit tests call
them without `await`), so with the async HTTP client the caller must `await`
`promote()`'s `promoted[]` promises, and `recall()` must be fed pre-fetched hits
rather than the async adapter directly. See `pipeline.integration.test.mjs`,
which exercises the real writes + real embedding search + real recall formatting
and **self-skips** (`t.skip`) when Mem0 is not running.
