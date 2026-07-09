# Per-task-class acceptance sign-off (PLAN Step 7.3)

The go-live gate, evaluated PER task class. Reuses the metrics contract from
`./metrics.mjs` (`computeRun`).

- **GO rule (per class):** a class is `sign-off` IFF
  `avg(tokenReductionPct) >= 20` AND `avg(qualityDropPct) <= 5`
  (same targets as acceptance #10; override via the `targets` arg). Otherwise
  `revert-to-single`, and `reason` names which target failed.
- **Aggregation:** the two gating percentages are AVERAGED across a class's runs;
  `retries` and `routerOverheadTokens` are summed as class totals (informational).
- **No live data => revert-to-single (D17 safe default):** real per-class LIVE
  data is intentionally PENDING, so an empty record set defaults to reverting to
  the proven single-agent baseline — a safe default with no negative return.
- **API:** `signoffClass(records, targets)`, `signoff(recordsByClass, targets)`
  (returns `{ results, signedOff, reverted }`, class order sorted/deterministic),
  and `formatSignoff(results)` (markdown table + the D17 note).
