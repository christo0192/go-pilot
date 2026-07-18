import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRecords } from "./production-metrics.mjs";

test("production metrics deduplicate run keys and count tokens only from latest records", () => {
  const base = { key: "f:t1:A", arm: "A", areaName: "document-qa", fixtureId: "f", failures: [], latencyMs: 100 };
  const result = summarizeRecords(
    [
      { ...base, tokens: { total: 999 }, estCostUsd: 9 },
      { ...base, tokens: { total: 100 }, estCostUsd: 0.01 },
      { ...base, key: "f:t2:A", tokens: { total: 200, reasoning: 50 }, estCostUsd: 0.02, latencyMs: 200 },
    ],
    [
      { key: "f:t1:A", finalScore: 80 },
      { key: "f:t1:A", finalScore: 90 },
      { key: "f:t2:A", finalScore: 100 },
    ],
    "document-qa",
  );
  assert.equal(result.runs, 2);
  assert.equal(result.successes, 2);
  assert.equal(result.quality, 95);
  assert.equal(result.totalTokens, 300);
  assert.equal(result.tokensPerSuccess, 150);
  assert.equal(result.costPerSuccessUsd, 0.015);
  assert.equal(result.maxLatencyMs, 200);
});

test("production metrics treat an ungraded run as a reliability failure", () => {
  const result = summarizeRecords(
    [{ key: "f:t1:A", arm: "A", areaName: "extraction", fixtureId: "f", failures: [], tokens: { total: 10 } }],
    [],
    "extraction",
  );
  assert.equal(result.runs, 1);
  assert.equal(result.successes, 0);
  assert.equal(result.reliabilityPct, 0);
  assert.equal(result.quality, null);
});
