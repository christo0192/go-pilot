// Hermetic tests for the reliability journal. No ports, no network — each test
// gets its own mkdtemp dir, tracked and torn down in after(). The clock is a
// deterministic counter so `ts` values are predictable.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createJournal, makeRunId, makeTaskId } from "./journal.mjs";

// Track every temp dir we create so after() can remove them all.
const dirs = [];
function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "jrnl-"));
  dirs.push(dir);
  return dir;
}

// A deterministic clock: returns 1000, 1001, 1002, ... on each call.
function counterClock(start = 1000) {
  let t = start;
  return () => t++;
}

function newJournal() {
  const dir = freshDir();
  return createJournal(join(dir, "journal.log"), { now: counterClock() });
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

// ── id helpers ──────────────────────────────────────────────────────────────

test("makeRunId is deterministic for equal inputs", () => {
  assert.equal(makeRunId("seedA", 0), "run-seedA-0");
  assert.equal(makeRunId("seedA", 0), makeRunId("seedA", 0));
  assert.notEqual(makeRunId("seedA", 0), makeRunId("seedA", 1));
  assert.notEqual(makeRunId("seedA", 0), makeRunId("seedB", 0));
});

test("makeTaskId is deterministic and scoped under its run", () => {
  const run = makeRunId("s", 7);
  assert.equal(makeTaskId(run, 3), "run-s-7-task-3");
  assert.equal(makeTaskId(run, 3), makeTaskId(run, 3));
  assert.notEqual(makeTaskId(run, 3), makeTaskId(run, 4));
});

// ── append + read ─────────────────────────────────────────────────────────────

test("append stamps monotonic seq and clock ts, and returns the record", () => {
  const j = newJournal();
  const a = j.append({ type: "note", msg: "one" });
  const b = j.append({ type: "note", msg: "two" });
  assert.equal(a.seq, 0);
  assert.equal(b.seq, 1);
  assert.equal(a.ts, 1000);
  assert.equal(b.ts, 1001);
  assert.equal(a.type, "note");
  assert.equal(a.msg, "one");
});

test("append + read round-trip preserves order and fields", () => {
  const j = newJournal();
  j.append({ type: "a", n: 1 });
  j.append({ type: "b", n: 2 });
  j.append({ type: "c", n: 3 });
  const recs = j.read();
  assert.equal(recs.length, 3);
  assert.deepEqual(recs.map((r) => r.type), ["a", "b", "c"]);
  assert.deepEqual(recs.map((r) => r.seq), [0, 1, 2]);
  assert.deepEqual(recs.map((r) => r.n), [1, 2, 3]);
});

test("read on a missing file returns an empty array (no throw)", () => {
  const dir = freshDir();
  const j = createJournal(join(dir, "does-not-exist.log"), { now: counterClock() });
  assert.deepEqual(j.read(), []);
});

// ── crash tolerance ───────────────────────────────────────────────────────────

test("read tolerates a truncated final line (crash mid-append)", () => {
  const j = newJournal();
  j.append({ type: "done", key: "k1", result: 1 });
  j.append({ type: "done", key: "k2", result: 2 });
  // Simulate a crash mid-append: a partial JSON fragment with no newline.
  appendFileSync(j.path, '{"type":"sta', "utf8");
  const recs = j.read();
  assert.equal(recs.length, 2, "the two good records survive");
  assert.deepEqual(recs.map((r) => r.key), ["k1", "k2"]);
});

test("read defensively skips a malformed middle line", () => {
  const j = newJournal();
  j.append({ type: "a", key: "k1" });
  // Corrupt line wedged in the middle, followed by a good line.
  appendFileSync(j.path, "NOT JSON AT ALL\n", "utf8");
  j.append({ type: "c", key: "k3" });
  const recs = j.read();
  assert.equal(recs.length, 2);
  assert.deepEqual(recs.map((r) => r.key), ["k1", "k3"]);
});

// ── dispatchOnce: idempotency ──────────────────────────────────────────────────

test("dispatchOnce runs fn once and records start then done", async () => {
  const j = newJournal();
  let calls = 0;
  const result = await j.dispatchOnce("job-1", async () => {
    calls++;
    return { ok: true };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true });

  const recs = j.read();
  assert.deepEqual(recs.map((r) => r.type), ["start", "done"]);
  assert.equal(recs[0].key, "job-1");
  assert.equal(recs[1].key, "job-1");
  assert.deepEqual(recs[1].result, { ok: true });
});

test("a second dispatchOnce with the same key returns cached result and does NOT re-run fn", async () => {
  const j = newJournal();
  let calls = 0;
  const fn = async () => {
    calls++;
    return calls; // would return 2 on a re-run — proves caching if it stays 1
  };
  const first = await j.dispatchOnce("job-x", fn);
  const second = await j.dispatchOnce("job-x", fn);
  assert.equal(first, 1);
  assert.equal(second, 1, "cached result replayed");
  assert.equal(calls, 1, "fn invoked exactly once — no duplicate work");
  // Only one start/done pair in the log.
  assert.deepEqual(j.read().map((r) => r.type), ["start", "done"]);
});

test("dispatchOnce caches a fresh instance too (survives a restart)", async () => {
  const dir = freshDir();
  const path = join(dir, "restart.log");
  let calls = 0;
  const fn = async () => {
    calls++;
    return "v";
  };
  const j1 = createJournal(path, { now: counterClock() });
  await j1.dispatchOnce("k", fn);
  // Simulate process restart: brand-new instance over the same file.
  const j2 = createJournal(path, { now: counterClock() });
  const again = await j2.dispatchOnce("k", fn);
  assert.equal(again, "v");
  assert.equal(calls, 1, "no re-execution after restart");
});

test("dispatchOnce caches a null/undefined-returning fn (stored as null)", async () => {
  const j = newJournal();
  let calls = 0;
  const fn = async () => {
    calls++;
    /* returns undefined */
  };
  const first = await j.dispatchOnce("nullish", fn);
  const second = await j.dispatchOnce("nullish", fn);
  assert.equal(first, undefined);
  assert.equal(second, null, "undefined result is stored/replayed as null");
  assert.equal(calls, 1, "still runs only once");
});

// ── dispatchOnce: failure ──────────────────────────────────────────────────────

test("dispatchOnce records failed and rethrows on error", async () => {
  const j = newJournal();
  await assert.rejects(
    () => j.dispatchOnce("boom", async () => {
      throw new Error("kaboom");
    }),
    /kaboom/,
  );
  const recs = j.read();
  assert.deepEqual(recs.map((r) => r.type), ["start", "failed"]);
  assert.equal(recs[1].key, "boom");
  assert.equal(recs[1].error, "kaboom");
});

test("a failed key is NOT cached — dispatchOnce retries fn", async () => {
  const j = newJournal();
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error("first fails");
    return "recovered";
  };
  await assert.rejects(() => j.dispatchOnce("retryable", fn), /first fails/);
  const out = await j.dispatchOnce("retryable", fn);
  assert.equal(out, "recovered");
  assert.equal(calls, 2, "failure does not block a retry");
});

// ── reconcile: startup recovery ────────────────────────────────────────────────

test("reconcile lists a key with start-but-no-done (in-flight at crash)", () => {
  const j = newJournal();
  // Simulate a crash after start, before done/failed.
  j.append({ type: "start", key: "inflight" });
  assert.deepEqual(j.reconcile(), ["inflight"]);
});

test("reconcile excludes completed and failed keys", async () => {
  const j = newJournal();
  await j.dispatchOnce("completed", async () => 1); // start + done
  j.append({ type: "start", key: "stuck" }); // in-flight
  j.append({ type: "start", key: "died" }); // will be failed below
  j.append({ type: "failed", key: "died", error: "x" });
  assert.deepEqual(j.reconcile(), ["stuck"]);
});

test("reconcile returns [] when nothing is in-flight", async () => {
  const j = newJournal();
  await j.dispatchOnce("a", async () => 1);
  await j.dispatchOnce("b", async () => 2);
  assert.deepEqual(j.reconcile(), []);
});

// ── readByKey helper ────────────────────────────────────────────────────────────

test("readByKey returns only that key's records in order", async () => {
  const j = newJournal();
  await j.dispatchOnce("k1", async () => "a");
  await j.dispatchOnce("k2", async () => "b");
  const k1 = j.readByKey("k1");
  assert.deepEqual(k1.map((r) => r.type), ["start", "done"]);
  assert.ok(k1.every((r) => r.key === "k1"));
});
