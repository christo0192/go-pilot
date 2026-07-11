import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { summarizeOverhead, formatReport } from "./overhead-report.mjs";

test("summarizeOverhead sums calls, tokens, and per-category totals", () => {
  const dir = mkdtempSync(join(tmpdir(), "overhead-"));
  const logPath = join(dir, "router-judgment.jsonl");

  const records = [
    { ts: "2026-07-09T00:00:00.000Z", taskId: "t1", category: "code", estimatedTokens: 100 },
    { ts: "2026-07-09T00:01:00.000Z", taskId: "t2", category: "code", estimatedTokens: 150 },
    { ts: "2026-07-09T00:02:00.000Z", taskId: "t3", category: "docs", estimatedTokens: 40 },
    { ts: "2026-07-09T00:03:00.000Z", taskId: "t4", category: "docs", estimatedTokens: 60 },
  ];

  // Include blank lines to confirm they are ignored.
  const content = "\n" + records.map((r) => JSON.stringify(r)).join("\n") + "\n\n";
  writeFileSync(logPath, content, "utf8");

  try {
    const summary = summarizeOverhead({ logPath });

    assert.equal(summary.calls, 4);
    assert.equal(summary.totalEstimatedTokens, 350);

    assert.deepEqual(summary.byCategory.code, { calls: 2, estimatedTokens: 250 });
    assert.deepEqual(summary.byCategory.docs, { calls: 2, estimatedTokens: 100 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeOverhead returns all-zeros for a non-existent path", () => {
  const summary = summarizeOverhead({ logPath: join(tmpdir(), "does-not-exist-12345.jsonl") });
  assert.deepEqual(summary, {
    calls: 0,
    totalEstimatedTokens: 0,
    totalActualTokens: 0,
    totalTokens: 0,
    actualCount: 0,
    byCategory: {},
  });
});

test("summarizeOverhead prefers ACTUAL tokens over the estimate when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "overhead-actual-"));
  const logPath = join(dir, "router-judgment.jsonl");

  const records = [
    // Actual present → the 900 actual is used instead of the 1500 estimate.
    { ts: "2026-07-11T00:00:00.000Z", taskId: "t1", category: "code", estimatedTokens: 1500, actualTokens: 900 },
    // No actual → falls back to the labeled estimate.
    { ts: "2026-07-11T00:01:00.000Z", taskId: "t2", category: "code", estimatedTokens: 1500, actualTokens: null },
    // Only a precomputed `tokens` field (as logJudgment writes) → used as-is.
    { ts: "2026-07-11T00:02:00.000Z", taskId: "t3", category: "docs", tokens: 300 },
  ];
  writeFileSync(logPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  try {
    const summary = summarizeOverhead({ logPath });

    assert.equal(summary.calls, 3);
    // 900 (actual) + 1500 (estimate) + 300 (tokens field) = 2700, NOT 3300.
    assert.equal(summary.totalTokens, 2700);
    assert.equal(summary.totalEstimatedTokens, 2700); // backward-compat alias
    assert.equal(summary.totalActualTokens, 900); // only the measured one
    assert.equal(summary.actualCount, 1);
    // Category rollup uses the actual-preferred effective figure.
    assert.deepEqual(summary.byCategory.code, { calls: 2, estimatedTokens: 2400 });
    assert.deepEqual(summary.byCategory.docs, { calls: 1, estimatedTokens: 300 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatReport mentions overhead and includes the totals", () => {
  const summary = {
    calls: 4,
    totalEstimatedTokens: 350,
    byCategory: {
      code: { calls: 2, estimatedTokens: 250 },
      docs: { calls: 2, estimatedTokens: 100 },
    },
  };

  const report = formatReport(summary);

  assert.match(report, /overhead/i);
  assert.match(report, /4/); // total calls
  assert.match(report, /350/); // total estimated tokens
  // Per-category values present.
  assert.match(report, /code/);
  assert.match(report, /250/);
  assert.match(report, /docs/);
});
