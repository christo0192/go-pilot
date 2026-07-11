import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStore, boomerang } from "./store.mjs";

// Track every temp dir so `node --test` exits with no leftover handles/files.
const tmpDirs = [];
function freshStore(opts) {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  tmpDirs.push(dir);
  return createStore(dir, opts);
}

// A store with a hand-cranked clock so lease/heartbeat/recovery are
// deterministic. `clock.t` is the current ms; bump it to advance time.
function clockedStore(leaseMs = 1000) {
  const clock = { t: 1_000_000 };
  return { store: freshStore({ now: () => clock.t, leaseMs }), clock };
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

  const claimA = store.claim("A", "worker-1");
  store.complete("A", { ok: true }, claimA.claimToken);

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

test("claim is refused while a dependency is unfinished, allowed once it is done", () => {
  const store = freshStore();
  store.add({ id: "A" });
  const b = store.add({ id: "B", deps: ["A"] });
  assert.equal(b.status, "pending");

  // B cannot be claimed before A is done — deps gate, not just the ready() view.
  assert.equal(store.claim("B", "w"), null, "B not claimable while A is pending");

  const a = store.claim("A", "w");
  store.complete("A", { ok: true }, a.claimToken);

  const claimedB = store.claim("B", "w");
  assert.ok(claimedB, "B claimable once A is done");
  assert.equal(claimedB.status, "claimed");
});

test("claim of a non-pending task returns null (no double-claim of a finished task)", () => {
  const store = freshStore();
  store.add({ id: "T" });
  const c = store.claim("T", "w1");
  store.complete("T", 1, c.claimToken);
  assert.equal(store.claim("T", "w2"), null, "a done task is not re-claimable");
});

test("full state machine: pending -> claimed -> validating -> done", () => {
  const store = freshStore();
  store.add({ id: "X" });

  const claimed = store.claim("X", "w");
  assert.equal(claimed.status, "claimed");
  assert.ok(claimed.claimToken, "claim issues a token");

  const validating = store.beginValidation("X", claimed.claimToken);
  assert.equal(validating.status, "validating");

  const done = store.complete("X", { out: 42 }, claimed.claimToken);
  assert.equal(done.status, "done");
  assert.equal(store.get("X").result.out, 42);
  assert.equal(store.get("X").leaseExpiresAt, null, "lease cleared on completion");
});

test("advancing a task requires the matching claim token", () => {
  const store = freshStore();
  store.add({ id: "X" });
  const claimed = store.claim("X", "w");

  assert.throws(() => store.complete("X", 1, "wrong-token"), /claim-token mismatch/);
  assert.throws(() => store.beginValidation("X", "nope"), /claim-token mismatch/);
  assert.throws(() => store.fail("X", "boom", "nope"), /claim-token mismatch/);

  // The real holder still succeeds.
  assert.equal(store.complete("X", 1, claimed.claimToken).status, "done");
});

test("complete/beginValidation on a task that is not claimed throws a clear error", () => {
  const store = freshStore();
  store.add({ id: "X" });
  // Never claimed -> no valid token, and status is pending.
  assert.throws(() => store.complete("X", 1, "any"), /not claimed\/validating/);
  assert.throws(() => store.complete("missing", 1, "any"), /unknown task/);
});

test("fail marks the task failed, records the reason, and keeps dependents blocked", () => {
  const store = freshStore();
  store.add({ id: "A" });
  store.add({ id: "B", deps: ["A"] });

  const a = store.claim("A", "w");
  store.fail("A", new Error("adapter exploded"), a.claimToken);

  const failed = store.get("A");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "adapter exploded");
  // A failed dep never satisfies the deps gate.
  assert.ok(!store.ready().some((t) => t.id === "B"), "B stays blocked behind a failed A");
  assert.equal(store.claim("B", "w"), null);
});

test("heartbeat renews the lease so a long task is not swept", () => {
  const { store, clock } = clockedStore(1000);
  store.add({ id: "L" });
  const c = store.claim("L", "w"); // leaseExpiresAt = t + 1000

  clock.t += 900;
  store.heartbeat("L", c.claimToken); // renews to t(=+900) + 1000

  clock.t += 900; // now +1800: past the ORIGINAL lease, within the renewed one
  assert.deepEqual(store.recoverStale(), [], "renewed lease is not stale");
  assert.equal(store.get("L").status, "claimed");
});

test("recoverStale returns a crashed worker's task to pending and lets another claim it", () => {
  const { store, clock } = clockedStore(1000);
  store.add({ id: "C" });

  const first = store.claim("C", "worker-1"); // worker-1 then 'crashes' (no heartbeat)
  assert.equal(store.get("C").status, "claimed");

  clock.t += 1001; // lease expires
  const recovered = store.recoverStale();
  assert.deepEqual(recovered, ["C"], "the expired claim is recovered");

  const back = store.get("C");
  assert.equal(back.status, "pending");
  assert.equal(back.worker, null);
  assert.equal(back.claimToken, null);

  // A fresh worker can now re-claim it...
  const second = store.claim("C", "worker-2");
  assert.ok(second, "recovered task is re-claimable");
  assert.notEqual(second.claimToken, first.claimToken, "a new token is issued");

  // ...and the crashed worker's stale token can no longer complete it (no
  // duplicated/lost work).
  assert.throws(() => store.complete("C", "zombie", first.claimToken), /claim-token mismatch/);
  assert.equal(store.complete("C", "real", second.claimToken).status, "done");
});

test("recoverStale leaves a healthy (unexpired) claim untouched", () => {
  const { store, clock } = clockedStore(1000);
  store.add({ id: "H" });
  store.claim("H", "w");
  clock.t += 500; // still within lease
  assert.deepEqual(store.recoverStale(), []);
  assert.equal(store.get("H").status, "claimed");
});

test("recoverStale rescues a task orphaned by a crash mid-claim (marker present, task still pending)", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  tmpDirs.push(dir);
  const store = createStore(dir);
  store.add({ id: "O" });

  // Simulate a crash AFTER the O_EXCL marker was created but BEFORE the task
  // was written to "claimed": task stays pending, an orphan marker lingers.
  const marker = join(dir, "claims", encodeURIComponent("O") + ".claim");
  writeFileSync(marker, JSON.stringify({ worker: "dead", token: "x", claimedAt: 0 }));

  // Without reconciliation the O_EXCL create would EEXIST forever -> unclaimable.
  assert.equal(store.claim("O", "w"), null, "orphan marker blocks the claim pre-recovery");

  store.recoverStale();
  const reclaimed = store.claim("O", "w");
  assert.ok(reclaimed, "task is claimable again after orphan-marker reconciliation");
  assert.equal(reclaimed.status, "claimed");
});

test("complete drops its claim marker so the claims dir stays bounded", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  tmpDirs.push(dir);
  const store = createStore(dir);
  store.add({ id: "D" });
  const c = store.claim("D", "w");
  const marker = join(dir, "claims", encodeURIComponent("D") + ".claim");
  assert.ok(existsSync(marker), "marker present while claimed");
  store.complete("D", 1, c.claimToken);
  assert.equal(existsSync(marker), false, "marker removed on completion");
});

test("atomic writes: a task record is always fully parseable after each move", () => {
  // Exercises the temp+rename path across every transition; if any left a
  // half-written file, get()/list() would throw on JSON.parse.
  const store = freshStore();
  store.add({ id: "Z" });
  const c = store.claim("Z", "w");
  store.beginValidation("Z", c.claimToken);
  store.complete("Z", { ok: 1 }, c.claimToken);
  assert.equal(store.list().length, 1);
  assert.equal(store.get("Z").status, "done");
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
