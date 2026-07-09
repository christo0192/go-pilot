# S03 — Router + Context Tiering — SLICE SUMMARY (core complete)

**Status:** buildable-now core COMPLETE (6/6 tasks). 3 external-tool pilots DEFERRED (tools not installed).
**Verification:** `node --test` → **42/42 pass**, clean process exit, **zero external dependencies**.
**Date:** 2026-07-09

## What was accomplished
The rig's orchestration core now exists as code in `src/` (was empty at slice start). All Node ESM, zero-dep,
each with its own `node --test` suite:

| Task | PLAN | Module | What it does |
|---|---|---|---|
| T01 | 3.1 | `src/router/` + `config/router.json` | Deterministic, profile-keyed router: work-type → {plane, model}; costed judgment escalation + separate log seam |
| T02 | 3.2 | `src/toon/` | TOON emit/parse for task specs — **42% fewer tokens than JSON** (round-trip proven) |
| T03 | 3.3 | `src/boundary/` | Reference>Compressed>Full guard — unjustified full content is downgraded/flagged, never passed raw (#1 invariant) |
| T04 | 3.9 | `src/router/overhead-report.mjs` | Router judgment cost as a distinct summable line item (never folded into savings) |
| T05 | 3.8 | `config/prompts/` + `src/prompts/` | Ponytail YAGNI fragment applied as a cacheable user-prompt PREFIX (not --system-prompt, D16) |
| T06 | 3.7 | `src/comms/` | localhost TCP mesh: peer FACT queries only; default routing rejected (chain-of-command stays default) |

## Files changed (aggregate)
`config/router.json`, `config/prompts/ponytail-yagni.txt`, `package.json` (new: type:module, test script, zero deps),
`src/router/{router,judgment-log,overhead-report}.mjs` (+tests +README), `src/toon/toon.mjs` (+test +README),
`src/boundary/guard.mjs` (+test +README), `src/prompts/fragment.mjs` (+test +README),
`src/comms/mesh.mjs` (+test +README), `metrics/toon-vs-json.md`.

## Deferred (need tools not installed — NOT blockers to core)
- **3.4 rtk** CLI-output compression proxy — rtk not installed.
- **3.5 CCE** pilot + fallback chain — CCE not installed.
- **3.6 context-mode** vs rtk+CCE consolidation spike — depends on 3.4+3.5.
All degrade-safe by design (D7); the boundary guard (T03) already provides the Reference/Compressed seam these
pilots would plug real compressors into. Revisit when the tools are installed (an environment/user decision).

## Decisions (→ DECISIONS.md D20–D22) · Lessons (→ KNOWLEDGE.md)
- D20 Node ESM zero-dep + profile-keyed config. D21 pilots deferred on tooling. D22 mesh exception-only.
- Knowledge: `node --test` gives a real test gate with zero install; `net.Server` has no `closeAllConnections`.

## Next
Reassess: S03 pilots + S04 (Memory/Mem0) both need environment setup (rtk/CCE, Docker) — a user/infra decision
point. Recommend confirming tool-install scope before S04, or proceeding with any pure-code S04 seams.
