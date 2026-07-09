# S04 — Memory (Tier-1 + Tier-2 seams) — SLICE SUMMARY (pure-code scope complete)

**Status:** all 5 pure-code seams COMPLETE (T01–T05). Real Mem0 (Step 4.3, Docker) DEFERRED behind a mock
adapter with an identical `{add, search}` contract — drop-in later.
**Verification:** `node --test` → **80/80 pass**, clean exit, **zero external dependencies**. 28 serial runs, 0 flakes.
**Date:** 2026-07-09

## What was accomplished — the two-tier memory core (D6), all in `src/memory/`
| Task | PLAN | Module | What it does |
|---|---|---|---|
| T01 | 4.1 | `store.mjs` | Tier-1 shared task store: atomic O_EXCL claim (one winner), deps/ready cascade, boomerang collapse-before-report |
| T02 | 4.2 | `gate.mjs` | Validation gate BEFORE compression (#6): pass→summarize, fail→FULL untouched (compressFn never called) |
| T03 | 4.3→mock | `mem0-adapter.mjs` | Stable `{add, search}` Tier-2 contract + deterministic in-memory mock (keyword-overlap, reproducible ids) |
| T04 | 4.4 | `promotion.mjs` | Promote to Tier-2 IFF gate-pass AND keeper-kind; failed/non-keeper excluded (anti-bloat/contamination) |
| T05 | 4.5 | `recall.mjs` | Session-start recall: query adapter → bounded few-hundred-token injection (chars/4 budget), replaces manual handover |

The pipeline composes: **store (Tier-1) → gate → promotion (keepers only) → mem0-adapter (Tier-2) → recall (session start)**.

## Files changed (aggregate)
`src/memory/{store,gate,mem0-adapter,promotion,recall}.mjs` (+ `.test.mjs` + `.README.md` each).

## Deferred (needs Docker — user/infra decision)
- **Step 4.3 real Mem0 deploy** — Docker not installed (user chose pure-code path 2026-07-09). The mock
  adapter's `{add, search}` contract is the ONLY coupling point; the real Mem0 client drops in behind it.
- **Step 4.5 residual** — real cross-session recall-vs-handover quality comparison (needs the deployed store).

## Decisions (→ D23) · Lessons (→ KNOWLEDGE)
- D23: memory seams built+tested against a mock Mem0 adapter; real Mem0 is a drop-in behind the same contract.
- Knowledge: parallel agents each running the FULL `node --test` in one checkout can transiently fail on each
  other's half-written files — verify counts with a SERIAL re-run before trusting them (not a code defect).

## Next (reassess)
Remaining M001 work needs environment setup or is workflow-layer: S03 pilots (rtk/CCE), S04 real Mem0 (Docker),
S05 (workflow skills + Phase-0 gate), S06 (self-installing repo), S07 (instrumentation + acceptance). Surface
the install-scope decision (Docker/rtk/CCE) to the user before S05/S06.
