# T04 — Router overhead instrumentation (PLAN Step 3.9)

## Goal
Report router LLM-judgment token cost as its own SUMMABLE line item, never folded into "savings"
(D8/D10). Builds on the T01 seam `metrics/runs/router-judgment.jsonl` written by `judgment-log.mjs`.

## Deliverables (Node ESM, zero deps)
1. `src/router/overhead-report.mjs` — `summarizeOverhead(opts = {})` reads the JSONL log
   (`opts.logPath` overrides; default `metrics/runs/router-judgment.jsonl`), returns
   `{ calls, totalEstimatedTokens, byCategory: {cat: {calls, estimatedTokens}} }`. Missing file → zeros.
   Add `formatReport(summary)` → a short markdown block labeling it explicitly as ROUTER OVERHEAD
   (distinct from savings).
2. `src/router/overhead-report.test.mjs` (`node --test`): write a temp JSONL fixture with a few
   judgment records across categories, assert the sums + per-category breakdown; assert missing file → zeros.
3. Acceptance: a run report shows router overhead as a distinct, summable metric.

## Out of scope
Savings computation; wiring into a live run (seam only). Do NOT modify package.json.
