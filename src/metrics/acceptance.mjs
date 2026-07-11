// Acceptance report — PLAN Step 7.2 (accounting corrected in Step 8.4).
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
//
// PORTFOLIO-WEIGHTED GATE (Step 8.4 — GPT-FINDINGS P0 #4): when several runs
// are evaluated together, the headline token reduction is computed from the
// AGGREGATE TOTALS of tokens, not from the equal-weight mean of per-run
// percentages. Averaging percentages lets a tiny task count as much as a huge
// one, so a batch could "PASS" while total tokens actually regressed. The
// portfolio number is the pass/fail gate; a distribution (median / p90 / stdev)
// is reported alongside it so the spread across runs stays visible.

import { computeRun } from "./metrics.mjs";
import { distribution, weightedMean } from "./stats.mjs";

/** Default #10 numeric-acceptance targets. */
export const DEFAULT_TARGETS = {
  minTokenReductionPct: 20,
  maxQualityDropPct: 5,
};

/**
 * Evaluate one metrics record OR an array of records against the targets.
 *
 * PORTFOLIO-WEIGHTED aggregation (Step 8.4):
 *   - Token reduction is the headline gate and comes from AGGREGATE TOTALS:
 *       tokenReductionPct = (Σ single − Σ multi) / Σ single × 100
 *     NOT the equal-weight mean of per-run percentages. A single tiny run can
 *     no longer swing the verdict.
 *   - Quality drop is size-weighted by each run's single-agent token cost
 *     (weightedMean of per-run qualityDropPct, weights = tokens.single).
 *   - retries and routerOverheadTokens are SUMMED (overhead is NEVER netted).
 *   - A distribution (median / p90 / stdev / sampleCount) of the per-run
 *     token-reduction and quality-drop percentages is reported alongside.
 *
 * A single record still behaves exactly as before: the portfolio number and the
 * weighted number both collapse to that record's own percentage.
 *
 * @param {object|object[]} recordOrRecords - a metrics record or array thereof
 * @param {{minTokenReductionPct?: number, maxQualityDropPct?: number}} [targets]
 * @returns {{
 *   tokenReduction: {value: number, target: number, pass: boolean},
 *   quality: {drop: number, target: number, pass: boolean},
 *   retries: {count: number, attempts: number},
 *   routerOverheadTokens: number,
 *   overallPass: boolean,
 *   records: object[],
 *   aggregate: {
 *     tokenReductionPct: number, qualityDropPct: number,
 *     tokensSingle: number, tokensMulti: number,
 *     meanTokenReductionPct: number, meanQualityDropPct: number
 *   },
 *   distribution: {
 *     tokenReductionPct: {median: number, p90: number, stdev: number, sampleCount: number},
 *     qualityDropPct: {median: number, p90: number, stdev: number, sampleCount: number}
 *   },
 *   sampleCount: number
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
  // computeRun() also validates, so record.tokens.* are guaranteed positive.
  const perRecord = records.map((record) => {
    const computed = computeRun(record);
    const tokenPass = computed.tokenReductionPct >= minTokenReductionPct;
    const qualityPass = computed.qualityDropPct <= maxQualityDropPct;
    return {
      runId: computed.runId,
      taskClass: computed.taskClass,
      tokensSingle: record.tokens.single,
      tokensMulti: record.tokens.multi,
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

  // --- Portfolio-weighted aggregate (the pass/fail gate) --------------------
  const tokensSingle = perRecord.reduce((s, r) => s + r.tokensSingle, 0);
  const tokensMulti = perRecord.reduce((s, r) => s + r.tokensMulti, 0);
  // tokensSingle > 0 always (each record's single is validated positive).
  const portfolioTokenReduction =
    ((tokensSingle - tokensMulti) / tokensSingle) * 100;

  // Quality drop weighted by single-agent token size of each run.
  const qualityDrops = perRecord.map((r) => r.quality.drop);
  const weights = perRecord.map((r) => r.tokensSingle);
  const weightedQualityDrop = weightedMean(qualityDrops, weights);

  // Unweighted means kept for transparency / comparison in the aggregate block.
  const tokenPcts = perRecord.map((r) => r.tokenReduction.value);

  // retries + overhead are SUMMED (overhead stays its own, un-netted ledger).
  const totalRetryCount = perRecord.reduce((s, r) => s + r.retries.count, 0);
  const totalRetryAttempts = perRecord.reduce(
    (s, r) => s + r.retries.attempts,
    0,
  );
  const totalRouterOverheadTokens = perRecord.reduce(
    (s, r) => s + r.routerOverheadTokens,
    0,
  );

  const tokenPass = portfolioTokenReduction >= minTokenReductionPct;
  const qualityPass = weightedQualityDrop <= maxQualityDropPct;

  return {
    tokenReduction: {
      value: portfolioTokenReduction,
      target: minTokenReductionPct,
      pass: tokenPass,
    },
    quality: {
      drop: weightedQualityDrop,
      target: maxQualityDropPct,
      pass: qualityPass,
    },
    retries: { count: totalRetryCount, attempts: totalRetryAttempts },
    routerOverheadTokens: totalRouterOverheadTokens,
    overallPass: tokenPass && qualityPass,
    records: perRecord,
    aggregate: {
      tokenReductionPct: portfolioTokenReduction,
      qualityDropPct: weightedQualityDrop,
      tokensSingle,
      tokensMulti,
      meanTokenReductionPct: tokenPcts.reduce((a, b) => a + b, 0) / tokenPcts.length,
      meanQualityDropPct:
        qualityDrops.reduce((a, b) => a + b, 0) / qualityDrops.length,
    },
    distribution: {
      tokenReductionPct: distribution(tokenPcts),
      qualityDropPct: distribution(qualityDrops),
    },
    sampleCount: perRecord.length,
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
  const {
    tokenReduction,
    quality,
    retries,
    routerOverheadTokens,
    overallPass,
    distribution: dist,
    sampleCount,
  } = evaluation;

  const lines = [];
  lines.push("# Acceptance Report");
  lines.push("");
  lines.push(`Records evaluated: ${evaluation.records.length}`);
  lines.push("");
  lines.push(
    "Pass/fail gate = the **portfolio-weighted** headline (aggregate totals, " +
      "NOT the equal-weight mean of per-run percentages).",
  );
  lines.push("");
  lines.push("| Metric | Value (gate) | Target | Result |");
  lines.push("| --- | --- | --- | --- |");
  lines.push(
    `| Token reduction (portfolio-weighted) | ${fmtPct(tokenReduction.value)} | >= ${tokenReduction.target}% | ${mark(tokenReduction.pass)} |`,
  );
  lines.push(
    `| Quality drop (size-weighted) | ${fmtPct(quality.drop)} | <= ${quality.target}% | ${mark(quality.pass)} |`,
  );
  lines.push(
    `| Retries | ${retries.count} retries / ${retries.attempts} attempts | informational | reported |`,
  );
  lines.push(
    `| Router overhead | ${routerOverheadTokens} tokens | informational | reported |`,
  );
  lines.push("");

  // Distribution across the individual runs — so a single big task can't hide
  // a wide spread behind the aggregate headline.
  if (dist) {
    lines.push(
      `Distribution across runs (n=${sampleCount}) — not the gate, context only:`,
    );
    lines.push("");
    lines.push("| Metric | median | p90 | stdev |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(
      `| Token reduction | ${fmtPct(dist.tokenReductionPct.median)} | ${fmtPct(dist.tokenReductionPct.p90)} | ${fmtPct(dist.tokenReductionPct.stdev)} |`,
    );
    lines.push(
      `| Quality drop | ${fmtPct(dist.qualityDropPct.median)} | ${fmtPct(dist.qualityDropPct.p90)} | ${fmtPct(dist.qualityDropPct.stdev)} |`,
    );
    lines.push("");
  }

  lines.push(
    `Router overhead (separate line item — not netted into savings): ${routerOverheadTokens} tokens`,
  );
  lines.push("");
  lines.push(`OVERALL: ${overallPass ? "PASS" : "FAIL"}`);
  lines.push("");

  return lines.join("\n");
}
