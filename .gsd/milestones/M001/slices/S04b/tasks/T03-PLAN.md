# S04b/T03 — Wire real Mem0 as default Tier-2
src/memory/tier2.mjs factory (mock|mem0|auto) selecting createMockMem0 vs createMem0Client by config; live integration test of gate->promotion->mem0-client->recall, skipped if Mem0 down (suite stays green). Node ESM zero-dep.
