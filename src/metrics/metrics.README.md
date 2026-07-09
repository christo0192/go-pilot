# Metrics pipeline (PLAN Step 7.1)

Captures, per run, the four acceptance metrics that feed the #10 numeric-acceptance gate.

**Record contract** (shared — later tasks depend on it):

```
{ runId: string,                                 // required, non-empty
  taskClass?: string,                            // optional
  tokens:  { single: number, multi: number },    // required, positive
  quality: { single: number, multi: number },    // required numbers
  retries: { count: number, attempts: number },  // required, non-negative ints
  routerOverheadTokens: number }                 // required, >= 0
```

**The four metrics** (`computeRun`): `tokenReductionPct = (single-multi)/single*100`
(token reduction vs single-agent baseline, negative if multi is worse); `qualityDropPct`
(same formula on rubric scores, negative if multi is better); `retries` (passed through);
`routerOverheadTokens` (router overhead).

**Ledger rule:** router overhead is its OWN line item — it is NEVER subtracted from or
netted into token savings. `withRouterOverhead()` fills it from the router judgment log
(`src/router/overhead-report.mjs`). `recordRun()` validates then appends one JSON line to
a JSONL log (default `metrics/runs/metrics.jsonl`); an invalid record throws and is not written.
