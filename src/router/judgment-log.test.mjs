import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logJudgment, FALLBACK_ESTIMATED_TOKENS } from "./judgment-log.mjs";

function freshLog() {
  const dir = mkdtempSync(join(tmpdir(), "judgment-"));
  return { dir, logPath: join(dir, "router-judgment.jsonl") };
}

test("actualTokens, when present, wins over the estimate and is labeled 'actual'", () => {
  const { dir, logPath } = freshLog();
  try {
    const written = logJudgment(
      { taskId: "t1", category: "code", estimatedTokens: 1500, actualTokens: 640 },
      { logPath },
    );
    assert.equal(written.tokens, 640, "honest figure = the measured actual");
    assert.equal(written.tokenSource, "actual");
    assert.equal(written.actualTokens, 640);
    assert.equal(written.estimatedTokens, 1500, "estimate still recorded verbatim");

    const parsed = JSON.parse(readFileSync(logPath, "utf8").trim());
    assert.deepEqual(parsed, written);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with no actual, the estimate is used and labeled 'estimate'", () => {
  const { dir, logPath } = freshLog();
  try {
    const written = logJudgment(
      { taskId: "t2", category: "docs", estimatedTokens: 1500 },
      { logPath },
    );
    assert.equal(written.tokens, 1500);
    assert.equal(written.tokenSource, "estimate");
    assert.equal(written.actualTokens, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with neither actual nor estimate, the LABELED 1500 fallback is used", () => {
  const { dir, logPath } = freshLog();
  try {
    const written = logJudgment({ taskId: "t3", category: "misc" }, { logPath });
    assert.equal(written.tokens, FALLBACK_ESTIMATED_TOKENS);
    assert.equal(FALLBACK_ESTIMATED_TOKENS, 1500);
    assert.equal(written.tokenSource, "fallback-estimate");
    assert.equal(written.actualTokens, null);
    assert.equal(written.estimatedTokens, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
