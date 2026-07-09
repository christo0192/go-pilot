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
  assert.deepEqual(summary, { calls: 0, totalEstimatedTokens: 0, byCategory: {} });
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
