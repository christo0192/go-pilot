---
task: T04
title: Router overhead instrumentation (PLAN Step 3.9)
status: complete
duration: ~6min
files_changed:
  - src/router/overhead-report.mjs
  - src/router/overhead-report.test.mjs
verification: node_test_pass, zero_deps
---

`summarizeOverhead()` reads the T01 judgment-log JSONL (`metrics/runs/router-judgment.jsonl`,
`estimatedTokens` field) → `{calls, totalEstimatedTokens, byCategory}`; missing file → zeros.
`formatReport()` emits markdown explicitly headed "Router Overhead (judgment cost — NOT savings)"
per D8/D10 (overhead is a distinct summable line item, never folded into savings). `null` category →
"uncategorized"; non-numeric tokens count as a call with 0 tokens. Verified via temp-JSONL fixture.
Suite green, zero deps.
