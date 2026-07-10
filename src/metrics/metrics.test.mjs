import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validateRecord,
  computeRun,
  recordRun,
  withRouterOverhead,
} from "./metrics.mjs";

// Track every temp dir so `node --test` exits clean.
const tmpDirs = [];
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "metrics-"));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function goodRecord(overrides = {}) {
  return {
    runId: "run-001",
    taskClass: "codegen",
    tokens: { single: 100, multi: 70 },
    quality: { single: 100, multi: 96 },
    retries: { count: 1, attempts: 3 },
    routerOverheadTokens: 42,
    ...overrides,
  };
}

// --- validateRecord --------------------------------------------------------

test("validateRecord accepts a good record", () => {
  const { valid, errors } = validateRecord(goodRecord());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateRecord rejects a missing runId", () => {
  const rec = goodRecord();
  delete rec.runId;
  const { valid, errors } = validateRecord(rec);
  assert.equal(valid, false);
  assert.ok(
    errors.some((e) => e.includes("runId")),
    "an error mentions runId",
  );
});

test("validateRecord rejects a non-positive tokens.single", () => {
  const { valid, errors } = validateRecord(goodRecord({ tokens: { single: 0, multi: 70 } }));
  assert.equal(valid, false);
  assert.ok(
    errors.some((e) => e.includes("tokens.single")),
    "an error mentions tokens.single",
  );
});

test("validateRecord rejects a missing quality", () => {
  const rec = goodRecord();
  delete rec.quality;
  const { valid, errors } = validateRecord(rec);
  assert.equal(valid, false);
  assert.ok(
    errors.some((e) => e.includes("quality")),
    "an error mentions quality",
  );
});

test("validateRecord rejects a negative retries.count", () => {
  const { valid, errors } = validateRecord(
    goodRecord({ retries: { count: -1, attempts: 3 } }),
  );
  assert.equal(valid, false);
  assert.ok(
    errors.some((e) => e.includes("retries.count")),
    "an error mentions retries.count",
  );
});

test("validateRecord rejects a missing routerOverheadTokens", () => {
  const rec = goodRecord();
  delete rec.routerOverheadTokens;
  const { valid, errors } = validateRecord(rec);
  assert.equal(valid, false);
  assert.ok(
    errors.some((e) => e.includes("routerOverheadTokens")),
    "an error mentions routerOverheadTokens",
  );
});

test("validateRecord never throws on junk input", () => {
  assert.doesNotThrow(() => validateRecord(null));
  assert.doesNotThrow(() => validateRecord(42));
  assert.doesNotThrow(() => validateRecord("nope"));
  assert.equal(validateRecord(null).valid, false);
});

// --- computeRun ------------------------------------------------------------

test("computeRun math: token reduction 30% and quality drop 4%", () => {
  const out = computeRun(goodRecord());
  assert.equal(out.tokenReductionPct, 30);
  assert.equal(out.qualityDropPct, 4);
  assert.equal(out.runId, "run-001");
  assert.equal(out.taskClass, "codegen");
});

test("computeRun keeps router overhead as its own line item (never netted)", () => {
  const out = computeRun(goodRecord({ routerOverheadTokens: 42 }));
  // 30% reduction is unchanged regardless of overhead — proves no netting.
  assert.equal(out.tokenReductionPct, 30);
  assert.equal(out.routerOverheadTokens, 42);
});

test("computeRun passes retries object through unchanged", () => {
  const retries = { count: 2, attempts: 5 };
  const out = computeRun(goodRecord({ retries }));
  assert.deepEqual(out.retries, retries);
});

test("computeRun does NOT clamp: multi worse -> negative reduction", () => {
  const out = computeRun(
    goodRecord({ tokens: { single: 100, multi: 130 }, quality: { single: 80, multi: 90 } }),
  );
  assert.equal(out.tokenReductionPct, -30); // multi cost MORE tokens
  assert.equal(out.qualityDropPct, -12.5); // multi quality BETTER
});

test("computeRun throws on an invalid record", () => {
  assert.throws(() => computeRun({ runId: "" }), /invalid metrics record/);
});

// --- recordRun -------------------------------------------------------------

test("recordRun appends a valid JSON line and returns computed metrics", () => {
  const logPath = join(freshDir(), "metrics.jsonl");
  const rec = goodRecord();

  const out = recordRun(rec, { logPath });
  assert.equal(out.tokenReductionPct, 30);
  assert.equal(out.qualityDropPct, 4);

  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.runId, "run-001");
  assert.deepEqual(parsed.tokens, { single: 100, multi: 70 });
  assert.equal(parsed.routerOverheadTokens, 42);
});

test("recordRun appends (does not overwrite) across calls", () => {
  const logPath = join(freshDir(), "metrics.jsonl");
  recordRun(goodRecord({ runId: "a" }), { logPath });
  recordRun(goodRecord({ runId: "b" }), { logPath });

  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).runId, "a");
  assert.equal(JSON.parse(lines[1]).runId, "b");
});

test("recordRun throws on an invalid record AND writes no line", () => {
  const logPath = join(freshDir(), "metrics.jsonl");
  const bad = goodRecord({ tokens: { single: -5, multi: 70 } });

  assert.throws(() => recordRun(bad, { logPath }), /refusing to write invalid metrics record/);

  // No file should have been created / written.
  assert.throws(() => readFileSync(logPath, "utf8"), /ENOENT/);
});

// --- withRouterOverhead ----------------------------------------------------

test("withRouterOverhead fills routerOverheadTokens from a seeded overhead JSONL", () => {
  const overheadLogPath = join(freshDir(), "router-judgment.jsonl");
  const judgments = [
    { ts: "2026-07-09T00:00:00.000Z", taskId: "t1", category: "code", estimatedTokens: 120 },
    { ts: "2026-07-09T00:01:00.000Z", taskId: "t2", category: "docs", estimatedTokens: 80 },
  ];
  writeFileSync(overheadLogPath, judgments.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

  const base = goodRecord({ routerOverheadTokens: 0 });
  const filled = withRouterOverhead(base, { overheadLogPath });

  assert.equal(filled.routerOverheadTokens, 200); // 120 + 80
  assert.equal(base.routerOverheadTokens, 0, "original record is not mutated");
  // Other fields carry through unchanged.
  assert.equal(filled.runId, base.runId);
  assert.deepEqual(filled.tokens, base.tokens);
});

test("validateRecord rejects quality.single <= 0 (review fix — avoids Infinity/NaN drop%)", () => {
  const base = {
    runId: "r", tokens: { single: 100, multi: 70 },
    quality: { single: 0, multi: 90 }, retries: { count: 0, attempts: 1 },
    routerOverheadTokens: 0,
  };
  const v = validateRecord(base);
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => e.includes("quality.single")), "flags quality.single > 0");
});
