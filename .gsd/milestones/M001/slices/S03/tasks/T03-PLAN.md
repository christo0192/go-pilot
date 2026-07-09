# T03 — Reference > Compressed > Full boundary guard (PLAN Step 3.3)

## Goal
Enforce the core token-efficiency invariant (#1, D7): content crossing a pane boundary is a
reference/pointer or a compressed summary by default — never raw full content unless explicitly
justified. A guard flags/blocks/downgrades unjustified full content.

## Design (Node ESM, zero deps — D20)
- `src/boundary/guard.mjs` exports `guardBoundary(payload, opts = {})`.
- `payload = { tier: "reference"|"compressed"|"full", content?, ref?, justification? }`.
- Rules (prefer the cheapest tier that preserves signal):
  - `reference` (a path/id/pointer) → always allowed, pass through.
  - `compressed` (a summary) → allowed, pass through.
  - `full` → allowed ONLY if `justification` is a non-empty string OR `content` length ≤ `opts.threshold`
    (default e.g. 800 chars). Otherwise DOWNGRADE: if `ref` is present → emit a `reference`; else emit
    `compressed` (truncate content to threshold + append an elision marker) and set `flagged:true`.
- Return `{ tier, content?|ref?, flagged:boolean, reason }`. Deterministic/pure (no I/O).

## Deliverables
1. `src/boundary/guard.mjs` — `guardBoundary` + exported default threshold constant.
2. `src/boundary/guard.test.mjs` (`node --test`):
   - reference & compressed pass through unchanged.
   - full + justification → allowed (not flagged).
   - full, no justification, over threshold, WITH ref → downgraded to reference, flagged.
   - full, no justification, over threshold, NO ref → downgraded to compressed (truncated + marker), flagged.
   - full under threshold → allowed.
   - **the acceptance test:** attempting to pass full content across a boundary without justification is
     NOT returned raw — assert the result tier != "full" OR flagged is true.
3. `src/boundary/README.md` — ~8 lines: the invariant, the tier ladder, downgrade rules.

## Acceptance
- `node --test` green (router + TOON + boundary all pass). Zero new deps.
- A test proving unjustified full content is downgraded/flagged, never passed raw.

## Out of scope
- Actual compression algorithms (rtk/CCE are deferred pilots) — "compressed" here = truncate+marker seam.
- Wiring the guard into live dispatch.
