import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluate, formatReport } from "./acceptance.mjs";

// Build a metrics record with tunable token/quality percentages.
// tokenReductionPct = (single - multi) / single * 100
// qualityDropPct    = (single - multi) / single * 100
function record(overrides = {}) {
  return {
    runId: "run-001",
    taskClass: "codegen",
    tokens: { single: 100, multi: 80 }, // 20% reduction
    quality: { single: 100, multi: 95 }, // 5% drop
    retries: { count: 1, attempts: 3 },
    routerOverheadTokens: 42,
    ...overrides,
  };
}

test("boundary: exactly 20% reduction / 5% drop → both PASS (inclusive)", () => {
  const evaluation = evaluate(record());
  assert.equal(evaluation.tokenReduction.value, 20);
  assert.equal(evaluation.tokenReduction.pass, true);
  assert.equal(evaluation.quality.drop, 5);
  assert.equal(evaluation.quality.pass, true);
  assert.equal(evaluation.overallPass, true);
});

test("15% reduction → tokenReduction fails and overall fails", () => {
  const evaluation = evaluate(
    record({ tokens: { single: 100, multi: 85 } }), // 15% reduction
  );
  assert.equal(evaluation.tokenReduction.value, 15);
  assert.equal(evaluation.tokenReduction.pass, false);
  assert.equal(evaluation.overallPass, false);
});

test("8% quality drop → quality fails and overall fails", () => {
  const evaluation = evaluate(
    record({ quality: { single: 100, multi: 92 } }), // 8% drop
  );
  assert.equal(evaluation.quality.drop, 8);
  assert.equal(evaluation.quality.pass, false);
  assert.equal(evaluation.overallPass, false);
});

test("strong record: 30% reduction / 2% drop → overall PASS", () => {
  const evaluation = evaluate(
    record({
      tokens: { single: 100, multi: 70 }, // 30% reduction
      quality: { single: 100, multi: 98 }, // 2% drop
    }),
  );
  assert.equal(evaluation.tokenReduction.value, 30);
  assert.equal(evaluation.quality.drop, 2);
  assert.equal(evaluation.overallPass, true);
});

test("array aggregation: percentages average, retries + overhead sum", () => {
  const strong = record({
    runId: "run-a",
    tokens: { single: 100, multi: 70 }, // 30% reduction
    quality: { single: 100, multi: 98 }, // 2% drop
    retries: { count: 1, attempts: 2 },
    routerOverheadTokens: 10,
  });
  // Individually fails token target (10%), but the average with `strong`
  // is 20% → aggregate passes. Proves verdict follows the average.
  const weak = record({
    runId: "run-b",
    tokens: { single: 100, multi: 90 }, // 10% reduction
    quality: { single: 100, multi: 96 }, // 4% drop
    retries: { count: 3, attempts: 5 },
    routerOverheadTokens: 30,
  });

  const evaluation = evaluate([strong, weak]);
  assert.equal(evaluation.tokenReduction.value, 20); // (30 + 10) / 2
  assert.equal(evaluation.quality.drop, 3); // (2 + 4) / 2
  assert.equal(evaluation.tokenReduction.pass, true);
  assert.equal(evaluation.overallPass, true);
  assert.equal(evaluation.retries.count, 4); // 1 + 3
  assert.equal(evaluation.retries.attempts, 7); // 2 + 5
  assert.equal(evaluation.routerOverheadTokens, 40); // 10 + 30 (never netted)
  assert.equal(evaluation.records.length, 2);
  // The weak record's own verdict is preserved per-record.
  assert.equal(evaluation.records[1].overallPass, false);
});

test("formatReport contains targets, marks, separate-overhead line, OVERALL", () => {
  const report = formatReport(evaluate(record()));
  assert.match(report, /# Acceptance Report/);
  assert.match(report, />= 20%/);
  assert.match(report, /<= 5%/);
  assert.ok(report.includes("✓") || report.includes("✗"));
  assert.match(
    report,
    /Router overhead \(separate line item — not netted into savings\): 42 tokens/,
  );
  assert.match(report, /OVERALL: PASS/);
});

test("formatReport shows FAIL when a target is missed", () => {
  const report = formatReport(
    evaluate(record({ tokens: { single: 100, multi: 85 } })),
  );
  assert.match(report, /✗/);
  assert.match(report, /OVERALL: FAIL/);
});

test("PORTFOLIO-weighted, NOT equal-average: a tiny run can't swing the gate", () => {
  // Big run: 1000 → 700 (30% reduction). Tiny run: 10 → 9 (10% reduction).
  // Equal-average of the percentages = (30 + 10) / 2 = 20% (borderline).
  // Portfolio (aggregate totals) = (1010 − 709) / 1010 = 29.80…% — the tiny
  // run barely moves it. The GATE must use the portfolio number.
  const big = record({
    runId: "big",
    tokens: { single: 1000, multi: 700 },
    quality: { single: 100, multi: 98 }, // 2% drop
  });
  const tiny = record({
    runId: "tiny",
    tokens: { single: 10, multi: 9 },
    quality: { single: 100, multi: 98 }, // 2% drop
  });

  const evaluation = evaluate([big, tiny]);

  // Portfolio number ≈ 29.8%, definitively NOT the 20% equal-average.
  assert.ok(Math.abs(evaluation.tokenReduction.value - 29.80198) < 1e-3);
  assert.notEqual(Math.round(evaluation.tokenReduction.value), 20);
  assert.equal(evaluation.tokenReduction.pass, true);
  assert.equal(evaluation.overallPass, true);

  // The equal-weight mean is still exposed for transparency — and it's 20%,
  // proving the gate deliberately does NOT use it.
  assert.equal(evaluation.aggregate.meanTokenReductionPct, 20);
  assert.equal(evaluation.aggregate.tokensSingle, 1010);
  assert.equal(evaluation.aggregate.tokensMulti, 709);
});

test("PORTFOLIO gate can FAIL even when the equal-average would PASS", () => {
  // Big run REGRESSES: 1000 → 995 (0.5% reduction). Tiny run: 10 → 3 (70%).
  // Equal-average = (0.5 + 70) / 2 = 35.25% → would PASS the 20% bar.
  // Portfolio = (1010 − 998) / 1010 = 1.188% → correctly FAILS: total tokens
  // barely moved because the big task dominates.
  const bigRegress = record({
    runId: "big",
    tokens: { single: 1000, multi: 995 },
  });
  const tinyWin = record({
    runId: "tiny",
    tokens: { single: 10, multi: 3 },
  });

  const evaluation = evaluate([bigRegress, tinyWin]);
  assert.ok(evaluation.tokenReduction.value < 2);
  assert.equal(evaluation.tokenReduction.pass, false);
  assert.equal(evaluation.overallPass, false);
  // Equal-average would have been >20 and wrongly passed.
  assert.ok(evaluation.aggregate.meanTokenReductionPct > 20);
});

test("distribution reports median / p90 / stdev / sampleCount per metric", () => {
  const recs = [10, 20, 30, 40, 50].map((mult, i) =>
    record({
      runId: `r${i}`,
      // single 100, multi chosen so reduction% = mult
      tokens: { single: 100, multi: 100 - mult },
      quality: { single: 100, multi: 100 - (i % 3) }, // drops 0,1,2,0,1
    }),
  );
  const evaluation = evaluate(recs);
  const d = evaluation.distribution.tokenReductionPct;
  assert.equal(d.sampleCount, 5);
  assert.equal(d.median, 30);
  assert.equal(d.p90, 46); // (5-1)*0.9 = 3.6 → 40 + 0.6*10
  assert.ok(Math.abs(d.stdev - Math.sqrt(200)) < 1e-9);
});

test("single record: portfolio == the record's own percentages (backward compatible)", () => {
  const evaluation = evaluate(record()); // 20% reduction, 5% drop
  assert.equal(evaluation.tokenReduction.value, 20);
  assert.equal(evaluation.quality.drop, 5);
  assert.equal(evaluation.sampleCount, 1);
  assert.equal(evaluation.distribution.tokenReductionPct.median, 20);
});

test("formatReport labels the gate as portfolio-weighted and shows the distribution", () => {
  const report = formatReport(
    evaluate([
      record({ runId: "a", tokens: { single: 1000, multi: 700 } }),
      record({ runId: "b", tokens: { single: 10, multi: 9 } }),
    ]),
  );
  assert.match(report, /portfolio-weighted/i);
  assert.match(report, /Distribution across runs/);
  assert.match(report, /median/);
});

test("custom targets override the verdict", () => {
  const rec = record({ tokens: { single: 100, multi: 85 } }); // 15% reduction
  // Default target (20%) → fail.
  assert.equal(evaluate(rec).overallPass, false);
  // Relaxed target (10%) → pass.
  const relaxed = evaluate(rec, { minTokenReductionPct: 10 });
  assert.equal(relaxed.tokenReduction.pass, true);
  assert.equal(relaxed.overallPass, true);
  // Stricter quality target flips a passing record to fail.
  const strict = evaluate(record(), { maxQualityDropPct: 4 }); // 5% drop
  assert.equal(strict.quality.pass, false);
  assert.equal(strict.overallPass, false);
});
