# S04: Memory (Tier-1 working + Mem0 Tier-2) — SCOPED to pure-code seams

**Scope decision (2026-07-09, user):** build the pure-code memory seams with NO installs. Real Mem0
(Step 4.3, Docker) is DEFERRED; instead a Mem0 **adapter interface + in-memory mock** lets 4.4/4.5 be
built and tested now. Wire the real Mem0 client behind the same interface when Docker is up.

Language = Node ESM, zero external deps (D20). Tests = `node --test`.

## Research (inline — substrate known from S03)
- Tier-1 working memory = boomerang (workers collapse their exchange to a short summary before
  reporting up) + a file-locked shared task store (claim/complete/cascade), pi-tasks style (D6).
- Validation gate (D9/#6): a result must pass a deterministic check (tests/lint/scope-match) BEFORE it
  may be summarized/compressed; failures propagate in FULL, never smoothed. Gate is BEFORE compression.
- Promotion filter (D6): at run end only validated keepers (summaries/decisions/prefs) go to Tier-2 Mem0.
- Existing lock primitive: `scripts/pane-lock.sh` (flock) for shell; the Node store needs its own
  in-process/file lock (atomic claim). The boundary guard (S03 T03) is the compression seam the gate precedes.

## Tasks
- [x] **T01: Boomerang + shared task store (Tier-1)** `est:25min` (Step 4.1) ✅ atomic claim, 55/55
  Depends on: S03 router (done). Independent of T02.
  Instructions: `src/memory/store.mjs` — a file-backed shared task store with atomic claim/complete/
  cascade + a `boomerang(exchange)` helper that collapses a worker exchange to a short summary. Atomic
  claim via lockfile (O_EXCL) or rename; concurrent claim of the same task yields exactly one winner.
  Acceptance: two concurrent claimers → one wins; a completed task cascades; boomerang returns a summary
  much shorter than the raw exchange. `node --test`.

- [x] **T02: Validation gate before compression** `est:25min` (Step 4.2) ✅ failures propagate full, 55/55
  Depends on: S03 boundary guard (done). Independent of T01.
  Instructions: `src/memory/gate.mjs` — `mustPass(result, checks)` runs deterministic checks
  (tests/lint/scope-match predicates) and returns `{passed, failures}`. `gateThenCompress(result, checks,
  compressFn)` — if passed → compress (summarize) via compressFn; if failed → return the FULL result
  untouched + `summarized:false`. Failures are never summarized. `node --test`.

## Then (fresh session — teed up)
- [x] **T03: Mem0 adapter interface + in-memory mock** (replaces Step 4.3 for now) ✅ 65/65
  `src/memory/mem0-adapter.mjs` — `{ add(memory), search(query, topK) }` interface + a deterministic
  in-memory mock impl (keyword/substring match). Real Docker Mem0 client implements the same interface later.
- [x] **T04: Promotion filter (Tier-1 → Mem0)** (Step 4.4) ✅ gate+keeper-kind; failed/non-keeper excluded. 80/80.
- [x] **T05: Session-start recall seam** (Step 4.5) ✅ bounded top-k injection (chars/4 budget). 80/80.
  Real-Mem0 cross-session comparison deferred until Docker/Mem0 exist (residual).

## Deferred (needs Docker — user/infra decision)
- Step 4.3 real Mem0 deploy; Step 4.5 real cross-session recall-vs-handover comparison.
