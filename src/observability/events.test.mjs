import { test } from "node:test";
import assert from "node:assert/strict";

import { createEventLog, redact, REDACTED, REDACTION_PATTERNS } from "./events.mjs";

// A deterministic, injectable clock: returns 1000, 1001, 1002, … on each call.
function fakeClock(start = 1000, step = 1) {
  let t = start;
  return () => {
    const v = t;
    t += step;
    return v;
  };
}

// ── redact ────────────────────────────────────────────────────────────────

test("redact: nested secret is removed while a benign sibling is preserved", () => {
  const input = { auth: { token: "abc" }, model: "sonnet" };
  const out = redact(input);
  // The secret value must not survive anywhere in the output.
  assert.ok(!JSON.stringify(out).includes("abc"));
  assert.equal(out.model, "sonnet");
});

test("redact: recurses into a benign parent and redacts only the token", () => {
  const out = redact({ meta: { token: "abc", note: "ok" }, model: "sonnet" });
  assert.equal(out.meta.token, REDACTED);
  assert.equal(out.meta.note, "ok");
  assert.equal(out.model, "sonnet");
});

test("redact: does not mutate the input", () => {
  const input = { password: "hunter2", nested: { secret: "s" } };
  const out = redact(input);
  assert.equal(input.password, "hunter2"); // original intact
  assert.equal(input.nested.secret, "s");
  assert.equal(out.password, REDACTED);
  assert.equal(out.nested.secret, REDACTED);
});

test("redact: walks into arrays of objects", () => {
  const out = redact({ items: [{ apiKey: "k1" }, { model: "haiku" }] });
  assert.equal(out.items[0].apiKey, REDACTED);
  assert.equal(out.items[1].model, "haiku");
});

test("redact: word-part matching redacts key variants but not lookalikes", () => {
  const out = redact({
    token: "t",
    apiKey: "a",
    api_key: "b",
    API_KEY: "c",
    password: "p",
    authorization: "z",
    dsn: "d",
    monkey: "keep", // contains "key" as a substring but is not a key word-part
    tokens: 42, // the METRIC field must survive (not "token")
  });
  assert.equal(out.token, REDACTED);
  assert.equal(out.apiKey, REDACTED);
  assert.equal(out.api_key, REDACTED);
  assert.equal(out.API_KEY, REDACTED);
  assert.equal(out.password, REDACTED);
  assert.equal(out.authorization, REDACTED);
  assert.equal(out.dsn, REDACTED);
  assert.equal(out.monkey, "keep");
  assert.equal(out.tokens, 42);
});

test("redact: honours extraKeys", () => {
  const out = redact({ ssn: "123", userSsn: "456", ok: "keep" }, { extraKeys: ["ssn"] });
  assert.equal(out.ssn, REDACTED);
  assert.equal(out.userSsn, REDACTED); // matched as a word-part of userSsn
  assert.equal(out.ok, "keep");
});

test("REDACTION_PATTERNS is exported and includes the core secret words", () => {
  assert.ok(Array.isArray(REDACTION_PATTERNS));
  for (const w of ["token", "secret", "password", "auth", "dsn", "credential"]) {
    assert.ok(REDACTION_PATTERNS.includes(w), `expected pattern ${w}`);
  }
});

// ── emit / all / byRun ──────────────────────────────────────────────────────

test("emit stamps ts + seq and returns the stored record", () => {
  const log = createEventLog({ now: fakeClock(1000) });
  const rec = log.emit({ runId: "r1", kind: "run.start" });
  assert.equal(rec.ts, 1000);
  assert.equal(rec.seq, 0);
  assert.equal(rec.runId, "r1");
  assert.equal(rec.kind, "run.start");
  assert.deepEqual(log.all()[0], rec);
});

test("emit assigns a monotonic seq and advancing ts", () => {
  const log = createEventLog({ now: fakeClock(500) });
  log.emit({ runId: "r1", kind: "a" });
  log.emit({ runId: "r1", kind: "b" });
  log.emit({ runId: "r1", kind: "c" });
  const all = log.all();
  assert.deepEqual(all.map((r) => r.seq), [0, 1, 2]);
  assert.deepEqual(all.map((r) => r.ts), [500, 501, 502]);
});

test("emit auto-redacts: a secret in an emitted event never appears in all()", () => {
  const log = createEventLog({ now: fakeClock() });
  log.emit({ runId: "r1", kind: "task.end", token: "super-secret", model: "sonnet" });
  const dump = JSON.stringify(log.all());
  assert.ok(!dump.includes("super-secret"));
  assert.equal(log.all()[0].token, REDACTED);
  assert.equal(log.all()[0].model, "sonnet"); // benign field survives
});

test("emit rejects a non-object event", () => {
  const log = createEventLog({ now: fakeClock() });
  assert.throws(() => log.emit(null));
  assert.throws(() => log.emit([1, 2]));
});

test("byRun filters to one run in emit order", () => {
  const log = createEventLog({ now: fakeClock() });
  log.emit({ runId: "r1", kind: "a" });
  log.emit({ runId: "r2", kind: "a" });
  log.emit({ runId: "r1", kind: "b" });
  const r1 = log.byRun("r1");
  assert.equal(r1.length, 2);
  assert.deepEqual(r1.map((r) => r.kind), ["a", "b"]);
  assert.equal(log.byRun("r2").length, 1);
});

test("sink callback is invoked with each redacted record", () => {
  const seen = [];
  const log = createEventLog({ now: fakeClock(), sink: (r) => seen.push(r) });
  log.emit({ runId: "r1", kind: "task.end", secret: "nope", tokens: 5 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].secret, REDACTED);
  assert.equal(seen[0].tokens, 5);
  assert.deepEqual(seen[0], log.all()[0]);
});

// ── inspect ─────────────────────────────────────────────────────────────────

function seededRun(log) {
  log.emit({ runId: "run-1", kind: "run.start" });
  log.emit({ runId: "run-1", kind: "task.end", taskId: "t1", ok: true, tokens: 100, costUsd: 1, latencyMs: 20, retries: 0 });
  log.emit({ runId: "run-1", kind: "task.end", taskId: "t2", ok: false, tokens: 200, costUsd: 5, latencyMs: 80, retries: 2, error: "boom" });
  log.emit({ runId: "run-1", kind: "task.end", taskId: "t3", ok: true, tokens: 50, costUsd: 2, latencyMs: 40, retries: 1 });
  log.emit({ runId: "run-1", kind: "run.end" });
}

test("inspect sums totals and counts events for a run", () => {
  const log = createEventLog({ now: fakeClock() });
  seededRun(log);
  const d = log.inspect("run-1");
  assert.equal(d.runId, "run-1");
  assert.equal(d.events, 5);
  assert.equal(d.timeline.length, 5);
  assert.deepEqual(d.totals, { tokens: 350, costUsd: 8, latencyMs: 140 });
});

test("inspect surfaces failures and sums retries", () => {
  const log = createEventLog({ now: fakeClock() });
  seededRun(log);
  const d = log.inspect("run-1");
  assert.equal(d.failures.length, 1);
  assert.equal(d.failures[0].taskId, "t2");
  assert.equal(d.retries, 3);
});

test("inspect identifies the slowest and most-expensive events", () => {
  const log = createEventLog({ now: fakeClock() });
  seededRun(log);
  const d = log.inspect("run-1");
  assert.equal(d.slowest.taskId, "t2");
  assert.equal(d.slowest.latencyMs, 80);
  assert.equal(d.mostExpensive.taskId, "t2");
  assert.equal(d.mostExpensive.costUsd, 5);
});

test("inspect of an unknown run returns an empty diagnosis", () => {
  const log = createEventLog({ now: fakeClock() });
  seededRun(log);
  const d = log.inspect("nope");
  assert.equal(d.events, 0);
  assert.deepEqual(d.timeline, []);
  assert.deepEqual(d.totals, { tokens: 0, costUsd: 0, latencyMs: 0 });
  assert.deepEqual(d.failures, []);
  assert.equal(d.retries, 0);
  assert.equal(d.slowest, null);
  assert.equal(d.mostExpensive, null);
});

// ── aggregate ────────────────────────────────────────────────────────────────

test("aggregate by model sums tokens/cost and computes rates + latency", () => {
  const log = createEventLog({ now: fakeClock() });
  log.emit({ runId: "r", kind: "task.end", model: "sonnet", ok: true, tokens: 100, costUsd: 1, latencyMs: 10, retries: 0 });
  log.emit({ runId: "r", kind: "task.end", model: "sonnet", ok: false, tokens: 200, costUsd: 2, latencyMs: 30, retries: 1 });
  log.emit({ runId: "r", kind: "task.end", model: "sonnet", ok: true, tokens: 300, costUsd: 3, latencyMs: 50, retries: 0 });
  log.emit({ runId: "r", kind: "task.end", model: "haiku", ok: true, tokens: 50, costUsd: 5, latencyMs: 5, retries: 2 });

  const agg = log.aggregate("model");

  assert.equal(agg.sonnet.count, 3);
  assert.equal(agg.sonnet.tokens, 600);
  assert.equal(agg.sonnet.costUsd, 6);
  assert.equal(agg.sonnet.okRate, 2 / 3);
  assert.equal(agg.sonnet.retryRate, 1 / 3);
  assert.equal(agg.sonnet.latency.median, 30); // median of [10,30,50]
  assert.equal(agg.sonnet.latency.p90, 46); // R-7 interp of [10,30,50] at p90

  assert.equal(agg.haiku.count, 1);
  assert.equal(agg.haiku.tokens, 50);
  assert.equal(agg.haiku.costUsd, 5);
  assert.equal(agg.haiku.okRate, 1);
  assert.equal(agg.haiku.retryRate, 1);
  assert.equal(agg.haiku.latency.median, 5);
});

test("aggregate skips records missing the dimension", () => {
  const log = createEventLog({ now: fakeClock() });
  log.emit({ runId: "r", kind: "task.end", provider: "anthropic", tokens: 10 });
  log.emit({ runId: "r", kind: "run.start" }); // no provider → skipped
  const agg = log.aggregate("provider");
  assert.deepEqual(Object.keys(agg), ["anthropic"]);
  assert.equal(agg.anthropic.count, 1);
});
