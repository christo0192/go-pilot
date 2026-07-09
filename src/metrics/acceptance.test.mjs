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
