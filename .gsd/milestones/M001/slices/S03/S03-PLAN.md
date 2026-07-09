# S03: Router + Context Tiering

Maps PLAN.md Sprint 3 (Steps 3.1–3.9) → tasks. Ordered by dependency + buildability under
`pure-anthropic` (S02 skipped). External-tool pilots (rtk/CCE/context-mode) are deferred until
their tool is installed. Language = Node.js ESM, zero external deps (D20). Tests = `node --test`.

## Tasks

- [x] **T01: Deterministic rule-based router** `est:25min` (PLAN Step 3.1) ✅ 10/10 tests
  Depends on: Independent (2.2 skipped; 1.2 substrate present)
  Instructions: Build `src/router/` — a profile-keyed config table (work-type category →
  {plane, model}) + a pure `route(task)` function returning `{plane, model, deterministic}` or a
  costed `{needsJudgment:true}` for ambiguous/unknown categories. Config lives in `config/router.json`
  (pure-anthropic mapping from S03-RESEARCH). Unit-test the mapping against a task fixture with `node --test`.
  Acceptance: fixture tasks each route to correct plane+model deterministically; ambiguous → judgment path.

- [x] **T02: TOON task-spec format** `est:20min` (PLAN Step 3.2) ✅ 42% < JSON, 18/18 tests
  Depends on: T01
  Instructions: `src/toon/` — emit/parse helper for task-spec artifacts in TOON. Round-trip test +
  a recorded token comparison vs JSON equivalent (write count to a metrics note).
  Acceptance: a task spec round-trips and is fewer tokens than its JSON form.

- [x] **T03: Reference > Compressed > Full boundary guard** `est:25min` (PLAN Step 3.3) ✅ 30/30 tests
  Depends on: T01
  Instructions: `src/boundary/` — a guard that inspects content crossing a pane boundary and
  downgrades/flags raw full content to reference-or-compressed unless explicitly justified.
  Acceptance: a test passing full content across a boundary is downgraded/flagged, not passed raw.

- [x] **T04: Router overhead instrumentation** `est:15min` (PLAN Step 3.9) ✅
  Depends on: T01
  Instructions: Log router LLM-judgment token cost as its own summable line item (never folded into
  "savings"). Emit to `metrics/runs/`. Acceptance: a run report shows router overhead as a distinct metric.

- [x] **T05: Ponytail YAGNI prompt fragment** `est:10min` (PLAN Step 3.8) ✅
  Depends on: Independent (prompt-only)
  Instructions: Add the reduced Ponytail YAGNI fragment to worker system prompts (a shared prompt
  fragment file the lean-worker path can prepend). Verify a sample task still passes.
  Acceptance: worker prompts include the fragment; sample task unaffected.

- [x] **T06: agent-comms P2P mesh (exception routing)** `est:25min` (PLAN Step 3.7) ✅ 42/42, clean exit
  Depends on: T01
  Instructions: localhost TCP mesh bridging panes, restricted to lateral/exception clarification;
  default routing still parent-through (chain-of-command, D9). Acceptance: a blocked worker can request
  a fact from a peer; default path unchanged.

## Deferred (need tools not yet installed — revisit when scheduled)
- Step 3.4 rtk CLI-output compression proxy (rtk not installed)
- Step 3.5 CCE pilot + fallback chain (CCE not installed)
- Step 3.6 context-mode vs rtk+CCE consolidation spike (depends on 3.4+3.5)
These degrade-safe by design (D7); deferral does not block the core router/tiering invariants.
