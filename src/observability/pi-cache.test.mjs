import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzePiSessions } from "./pi-cache.mjs";

test("Pi cache telemetry separates cumulative, latest, warm eligibility, and model switches", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-cache-"));
  const path = join(dir, "session.jsonl");
  const row = (ts, model, input, cacheRead) => JSON.stringify({
    type: "message", timestamp: ts,
    message: { role: "assistant", model, provider: "ikey", usage: { input, cacheRead } },
  });
  writeFileSync(path, [
    row("2026-01-01T00:00:00Z", "deepseek", 1000, 0),
    row("2026-01-01T00:01:00Z", "deepseek", 20, 1980),
    row("2026-01-01T00:02:00Z", "kimi", 1500, 0),
  ].join("\n"));
  const out = analyzePiSessions(dir);
  assert.equal(out.cumulative.hitPct, 44);
  assert.equal(out.latest.hitPct, 0);
  assert.equal(out.eligibleWarm.calls, 1);
  assert.equal(out.eligibleWarm.at98Pct, 100);
  assert.equal(out.coldReasons.firstCall, 1);
  assert.equal(out.coldReasons.modelSwitch, 1);
});
