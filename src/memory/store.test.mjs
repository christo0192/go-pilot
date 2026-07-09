import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStore, boomerang } from "./store.mjs";

// Track every temp dir so `node --test` exits with no leftover handles/files.
const tmpDirs = [];
function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  tmpDirs.push(dir);
  return createStore(dir);
}

after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

test("add + get round-trips; duplicate add throws", () => {
  const store = freshStore();

  const added = store.add({ id: "A", label: "first" });
  assert.equal(added.status, "pending");

  const got = store.get("A");
  assert.equal(got.id, "A");
  assert.equal(got.label, "first");
  assert.equal(got.status, "pending");
  assert.deepEqual(got.deps, []);

  assert.throws(() => store.add({ id: "A" }), /already exists/);
});

test("atomic claim: exactly one of two concurrent claims wins", async () => {
  const store = freshStore();
  store.add({ id: "T" });

  // Fire both claims concurrently. O_EXCL guarantees exactly one winner even
  // across processes — a true multi-process test is possible later, but the
  // filesystem marker makes this in-process race representative.
  const results = await Promise.all([
    Promise.resolve().then(() => store.claim("T", "worker-1")),
    Promise.resolve().then(() => store.claim("T", "worker-2")),
  ]);

  const winners = results.filter(Boolean);
  const losers = results.filter((r) => !r);
  assert.equal(winners.length, 1, "exactly one claim must win");
  assert.equal(losers.length, 1, "exactly one claim must lose");

  const persisted = store.get("T");
  assert.equal(persisted.status, "claimed");
  assert.equal(persisted.worker, winners[0].worker);
});

test("claim of an unknown id returns null (no throw)", () => {
  const store = freshStore();
  assert.equal(store.claim("does-not-exist", "worker-1"), null);
});

test("complete + ready/cascade: dependents unblock only after deps are done", () => {
  const store = freshStore();
  store.add({ id: "A" });
  store.add({ id: "B", deps: ["A"] });

  // B is NOT ready while A is still pending.
  let readyIds = store.ready().map((t) => t.id);
  assert.ok(readyIds.includes("A"), "A (no deps) should be ready");
  assert.ok(!readyIds.includes("B"), "B must not be ready before A completes");

  store.claim("A", "worker-1");
  store.complete("A", { ok: true });

  // Completing A cascades: B now appears in ready().
  readyIds = store.ready().map((t) => t.id);
  assert.ok(readyIds.includes("B"), "B must be ready after A is done");
  assert.ok(!readyIds.includes("A"), "A is done, no longer pending/ready");

  // cascade is an alias of ready.
  assert.deepEqual(
    store.cascade().map((t) => t.id),
    readyIds,
  );

  assert.equal(store.get("A").result.ok, true);
});

test("boomerang collapses a long exchange and preserves a DECISION/RESULT line", () => {
  const exchange = [
    "worker: starting task, reading files",
    "worker: found 12 candidate modules to inspect",
    "worker: ran the test suite, all green so far",
    "worker: considered approach A and approach B at length",
    "DECISION: use approach B because it avoids the read-then-write race",
    "worker: implemented, re-ran everything, cleaned up temp dirs",
    "RESULT: store.mjs done, 6 tests passing, zero new deps",
  ];
  const input = exchange.join("\n");

  const summary = boomerang(exchange);

  assert.ok(
    summary.length < input.length / 2,
    `summary (${summary.length}) should be far shorter than input (${input.length})`,
  );
  assert.match(summary, /DECISION: use approach B/);
  assert.match(summary, /RESULT: store\.mjs done/);
});

test("boomerang uses an injected summarizeFn when provided", () => {
  const out = boomerang(["a", "b", "c"], () => "INJECTED");
  assert.equal(out, "INJECTED");
});
