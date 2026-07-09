# Validation gate BEFORE compression

Correctness-of-memory invariant (#6): a result must pass deterministic checks
(tests / lint / scope-match) BEFORE it may be summarized or compressed. The gate
runs first; compression is second.

- `mustPass(result, checks)` runs every `{ name, run }` check and returns
  `{ passed, failures }`. A check that throws IS a failure (its message becomes
  the detail) — `mustPass` never throws.
- `gateThenCompress(result, checks, compressFn)`: on pass, returns the compressed
  output; on ANY failure it returns the FULL, untouched `result` and never calls
  `compressFn`. Failures propagate in full detail — never smoothed into a clean
  summary.
- Check-factory pattern: `testsPass(fn)`, `scopeMatch(allowedPaths)`, and
  `noPlaceholders()` are small pure factories that each yield a `{ name, run }`
  predicate you compose into the `checks` array.
