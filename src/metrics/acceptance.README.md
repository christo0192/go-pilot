# Acceptance report (PLAN Step 7.2)

Renders the four run metrics from `metrics.mjs::computeRun` against the #10
numeric-acceptance targets. Import `evaluate(recordOrRecords, targets)` and
`formatReport(evaluation)` from `acceptance.mjs`.

The four metrics:

1. **Token reduction** — PASS when `tokenReductionPct >= 20`.
2. **Quality drop** — PASS when `qualityDropPct <= 5`.
3. **Retries** — informational only; surfaced, never pass/fail.
4. **Router overhead** — informational only; shown as its OWN line item and
   **never subtracted from / netted into** token savings.

`overallPass = tokenReduction.pass && quality.pass` (retries and overhead never
affect the verdict). Targets default to `>=20%` / `<=5%` and are overridable via
the `targets` arg. Arrays are aggregated by **averaging** the two percentages and
**summing** retries + overhead before comparing to targets, while per-record
results are kept under `records`.
