---
task: S04/T04
title: Promotion filter (Tier-1 → Mem0) — PLAN Step 4.4
status: complete
duration: ~10min
files_changed: [src/memory/promotion.mjs, src/memory/promotion.test.mjs, src/memory/promotion.README.md]
verification: node_test_80_pass, zero_deps, mutation_flake_root_caused_not_a_bug
---
`promote(candidates, adapter, opts)` distills to Tier-2 ONLY items that BOTH pass the gate (`mustPass`
from gate.mjs) AND are a keeper kind (decision/summary/pref; `opts.keeperKinds` override). Failed →
skipped "failed-gate"; non-keeper/kindless → "non-keeper-kind"; neither reaches the adapter (anti-bloat/
contamination, D6). Returns `{promoted, skipped}`. Reuses gate.mjs + mem0-adapter.mjs; pure aside from
`adapter.add`. 8 tests incl. mixed-batch exact-set + core "failed excluded". Suite 80/80.

Note: a "flaky" mutation test flagged during parallel dev was ROOT-CAUSED to a concurrent-agent
write race (T05's full-suite run hit T04's half-written file), NOT a code defect — `adapter.add` clones
(`{...memory, id, tags:[...]}`), `promote` only passes refs. 28 serial runs post-completion: 0 fails. (→ KNOWLEDGE)
