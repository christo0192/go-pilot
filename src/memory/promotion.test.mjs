import { test } from "node:test";
import assert from "node:assert/strict";

import { promote, DEFAULT_KEEPER_KINDS } from "./promotion.mjs";
import { createMockMem0 } from "./mem0-adapter.mjs";

// A check that always passes and one that always fails, in the gate's shape.
const okCheck = { name: "ok", run: () => true };
const failCheck = { name: "fail", run: () => ({ ok: false, detail: "nope" }) };

test("keeper-kind candidate that passes its gate IS added and reported as promoted", async () => {
  const adapter = createMockMem0();
  const candidate = {
    memory: { text: "chose litellm as the router", kind: "decision" },
    checks: [okCheck],
  };

  const report = await promote([candidate], adapter);

  assert.equal(report.promoted.length, 1);
  assert.equal(report.skipped.length, 0);
  assert.equal(report.promoted[0].text, "chose litellm as the router");
  assert.ok(report.promoted[0].id, "adapter assigned an id");

  // It is actually retrievable from the adapter.
  const hits = adapter.search("litellm router");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memory.text, "chose litellm as the router");
});

test("CORE: a candidate that FAILS a gate check is NOT added and is skipped as failed-gate", async () => {
  const adapter = createMockMem0();
  const candidate = {
    memory: { text: "bad fact that failed validation", kind: "decision" },
    checks: [failCheck],
  };

  const report = await promote([candidate], adapter);

  assert.equal(report.promoted.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "failed-gate");
  assert.equal(report.skipped[0].memory, candidate.memory);

  // Nothing landed in Tier-2.
  assert.equal(adapter.search("bad fact").length, 0);
});

test("non-keeper kind is NOT added even when it passes the gate, skipped as non-keeper-kind", async () => {
  const adapter = createMockMem0();
  const candidate = {
    memory: { text: "temporary scratch note about a stack trace", kind: "scratch" },
    checks: [okCheck],
  };

  const report = await promote([candidate], adapter);

  assert.equal(report.promoted.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "non-keeper-kind");
  assert.equal(adapter.search("scratch note").length, 0);
});

test("a candidate with NO kind is treated as non-keeper (not promoted)", async () => {
  const adapter = createMockMem0();
  const report = await promote(
    [{ memory: { text: "kindless note" }, checks: [] }],
    adapter,
  );

  assert.equal(report.promoted.length, 0);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "non-keeper-kind");
});

test("MIXED batch: ONLY validated keepers end up in the adapter (exact set)", async () => {
  const adapter = createMockMem0();

  const keeperDecision = { memory: { text: "keeper decision alpha", kind: "decision" }, checks: [okCheck] };
  const failedKeeper = { memory: { text: "failed keeper bravo", kind: "summary" }, checks: [failCheck] };
  const nonKeeper = { memory: { text: "scratch charlie", kind: "scratch" }, checks: [okCheck] };
  const keeperPref = { memory: { text: "keeper pref delta", kind: "pref" }, checks: [okCheck] };
  const keeperSummary = { memory: { text: "keeper summary echo", kind: "summary" }, checks: [] };

  const report = await promote(
    [keeperDecision, failedKeeper, nonKeeper, keeperPref, keeperSummary],
    adapter,
  );

  // Exactly the three validated keepers were promoted, in input order.
  assert.deepEqual(
    report.promoted.map((m) => m.text),
    ["keeper decision alpha", "keeper pref delta", "keeper summary echo"],
  );

  // The two rejects carry the right reasons, in input order.
  assert.deepEqual(
    report.skipped.map((s) => s.reason),
    ["failed-gate", "non-keeper-kind"],
  );

  // The adapter contains ONLY the keepers — the bad fact and scratch are absent.
  // Search by each memory's UNIQUE token (the mock matches any token overlap).
  assert.equal(adapter.search("alpha").length, 1);
  assert.equal(adapter.search("delta").length, 1);
  assert.equal(adapter.search("echo").length, 1);
  assert.equal(adapter.search("bravo").length, 0);
  assert.equal(adapter.search("charlie").length, 0);
});

test("opts.keeperKinds override changes which kinds are promoted", async () => {
  const adapter = createMockMem0();

  const noteKind = { memory: { text: "note kind item", kind: "note" }, checks: [okCheck] };
  const decisionKind = { memory: { text: "decision kind item", kind: "decision" }, checks: [okCheck] };

  // Only "note" is a keeper now; the default "decision" is NOT.
  const report = await promote([noteKind, decisionKind], adapter, { keeperKinds: ["note"] });

  assert.deepEqual(report.promoted.map((m) => m.text), ["note kind item"]);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].reason, "non-keeper-kind");
  assert.equal(report.skipped[0].memory.kind, "decision");
});

test("default keeper kinds are decision | summary | pref", () => {
  assert.deepEqual(DEFAULT_KEEPER_KINDS, ["decision", "summary", "pref"]);
});

test("inputs are NOT mutated", async () => {
  const adapter = createMockMem0();
  const memory = { text: "immutable decision", kind: "decision", tags: ["a"] };
  const candidate = { memory, checks: [okCheck] };
  // Snapshot only the data (functions can't be JSON-cloned).
  const memorySnapshot = JSON.parse(JSON.stringify(memory));

  const before = { memoryRef: candidate.memory, checksRef: candidate.checks, tagsRef: memory.tags };
  await promote([candidate], adapter);

  // The candidate's memory is byte-for-byte unchanged and identity-stable.
  assert.deepEqual(memory, memorySnapshot);
  assert.deepEqual(memory.tags, ["a"]);
  assert.equal(candidate.memory, before.memoryRef, "candidate.memory not reassigned");
  assert.equal(candidate.checks, before.checksRef, "candidate.checks not reassigned");
  assert.equal(memory.tags, before.tagsRef, "tags array not replaced");
});
