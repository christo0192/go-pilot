// Acceptance report — PLAN Step 7.2.
//
// Renders the four metrics (from src/metrics/metrics.mjs::computeRun) against
// the #10 numeric-acceptance targets:
//   1. token reduction — PASS if tokenReductionPct >= minTokenReductionPct (20)
//   2. quality drop    — PASS if qualityDropPct <= maxQualityDropPct (5)
//   3. retries         — informational only (surfaced, no pass/fail)
//   4. router overhead — informational only, ALWAYS its OWN line item and
//                        NEVER subtracted from / netted against token savings.
//
// overallPass = tokenReduction.pass && quality.pass. Retries and router
// overhead do not affect the verdict.

import { computeRun } from "./metrics.mjs";

/** Default #10 numeric-acceptance targets. */
export const DEFAULT_TARGETS = {
  minTokenReductionPct: 20,
  maxQualityDropPct: 5,
};

/**
 * Evaluate one metrics record OR an array of records against the targets.
 *
 * For an array, the token-reduction and quality-drop percentages are AVERAGED
 * across records, and retries + routerOverheadTokens are SUMMED, BEFORE the
 * aggregate is compared to the targets. Per-record evaluations are also kept.
 *
 * @param {object|object[]} recordOrRecords - a metrics record or array thereof
 * @param {{minTokenReductionPct?: number, maxQualityDropPct?: number}} [targets]
 * @returns {{
 *   tokenReduction: {value: number, target: number, pass: boolean},
 *   quality: {drop: number, target: number, pass: boolean},
 *   retries: {count: number, attempts: number},
 *   routerOverheadTokens: number,
 *   overallPass: boolean,
 *   records: object[]
 * }}
 */
export function evaluate(recordOrRecords, targets = {}) {
  const minTokenReductionPct =
    targets.minTokenReductionPct ?? DEFAULT_TARGETS.minTokenReductionPct;
  const maxQualityDropPct =
    targets.maxQualityDropPct ?? DEFAULT_TARGETS.maxQualityDropPct;

  const records = Array.isArray(recordOrRecords)
    ? recordOrRecords
    : [recordOrRecords];

  if (records.length === 0) {
    throw new Error("evaluate requires at least one metrics record");
  }

  // Derive per-record metrics via the shared contract (never recompute here).
  const perRecord = records.map((record) => {
    const computed = computeRun(record);
    const tokenPass = computed.tokenReductionPct >= minTokenReductionPct;
    const qualityPass = computed.qualityDropPct <= maxQualityDropPct;
    return {
      runId: computed.runId,
      taskClass: computed.taskClass,
      tokenReduction: {
        value: computed.tokenReductionPct,
        target: minTokenReductionPct,
        pass: tokenPass,
      },
      quality: {
        drop: computed.qualityDropPct,
        target: maxQualityDropPct,
        pass: qualityPass,
      },
      retries: computed.retries,
      routerOverheadTokens: computed.routerOverheadTokens,
      overallPass: tokenPass && qualityPass,
    };
  });

  // Aggregate: AVERAGE the percentages, SUM retries + overhead.
  const n = perRecord.length;
  const avgTokenReduction =
    perRecord.reduce((sum, r) => sum + r.tokenReduction.value, 0) / n;
  const avgQualityDrop =
    perRecord.reduce((sum, r) => sum + r.quality.drop, 0) / n;
  const totalRetryCount = perRecord.reduce(
    (sum, r) => sum + r.retries.count,
    0,
  );
  const totalRetryAttempts = perRecord.reduce(
    (sum, r) => sum + r.retries.attempts,
    0,
  );
  // Router overhead stays its OWN line item — summed, never netted into savings.
  const totalRouterOverheadTokens = perRecord.reduce(
    (sum, r) => sum + r.routerOverheadTokens,
    0,
  );

  const tokenPass = avgTokenReduction >= minTokenReductionPct;
  const qualityPass = avgQualityDrop <= maxQualityDropPct;

  return {
    tokenReduction: {
      value: avgTokenReduction,
      target: minTokenReductionPct,
      pass: tokenPass,
    },
    quality: {
      drop: avgQualityDrop,
      target: maxQualityDropPct,
      pass: qualityPass,
    },
    retries: { count: totalRetryCount, attempts: totalRetryAttempts },
    routerOverheadTokens: totalRouterOverheadTokens,
    overallPass: tokenPass && qualityPass,
    records: perRecord,
  };
}

/** Round to one decimal place for stable, human-readable report output. */
function fmtPct(value) {
  return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
}

/** ✓ / ✗ marker for a pass/fail boolean. */
function mark(pass) {
  return pass ? "✓" : "✗";
}

/**
 * Render a deterministic markdown acceptance report from an evaluation.
 *
 * @param {ReturnType<typeof evaluate>} evaluation
 * @returns {string} markdown report
 */
export function formatReport(evaluation) {
  const { tokenReduction, quality, retries, routerOverheadTokens, overallPass } =
    evaluation;

  const lines = [];
  lines.push("# Acceptance Report");
  lines.push("");
  lines.push(`Records evaluated: ${evaluation.records.length}`);
  lines.push("");
  lines.push("| Metric | Value | Target | Result |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    `| Token reduction | ${fmtPct(tokenReduction.value)} | >= ${tokenReduction.target}% | ${mark(tokenReduction.pass)} |`,
  );
  lines.push(
    `| Quality drop | ${fmtPct(quality.drop)} | <= ${quality.target}% | ${mark(quality.pass)} |`,
  );
  lines.push(
    `| Retries | ${retries.count} retries / ${retries.attempts} attempts | informational | reported |`,
  );
  lines.push(
    `| Router overhead | ${routerOverheadTokens} tokens | informational | reported |`,
  );
  lines.push("");
  lines.push(
    `Router overhead (separate line item — not netted into savings): ${routerOverheadTokens} tokens`,
  );
  lines.push("");
  lines.push(`OVERALL: ${overallPass ? "PASS" : "FAIL"}`);
  lines.push("");

  return lines.join("\n");
}
