import { test } from "node:test";
import assert from "node:assert/strict";

import { createMockMem0 } from "./mem0-adapter.mjs";

test("add assigns a deterministic id when none is given", () => {
  const m = createMockMem0();
  const a = m.add({ text: "first memory" });
  const b = m.add({ text: "second memory" });
  assert.equal(a.id, "mem-0");
  assert.equal(b.id, "mem-1");
});

test("ids are reproducible across two fresh mocks fed the same sequence", () => {
  const seq = [
    { text: "chose approach B for the race" },
    { text: "user prefers terse prompts" },
    { text: "summary of sprint one substrate" },
  ];
  const one = createMockMem0();
  const two = createMockMem0();
  const idsA = seq.map((mem) => one.add({ ...mem }).id);
  const idsB = seq.map((mem) => two.add({ ...mem }).id);
  assert.deepEqual(idsA, idsB);
  assert.deepEqual(idsA, ["mem-0", "mem-1", "mem-2"]);
});

test("add then search: an overlapping query returns that memory first with score > 0", () => {
  const m = createMockMem0();
  m.add({ text: "the cascade unblocks dependents when deps are done" });
  m.add({ text: "unrelated note about coffee" });

  const hits = m.search("cascade dependents");
  assert.ok(hits.length >= 1);
  assert.match(hits[0].memory.text, /cascade unblocks dependents/);
  assert.ok(hits[0].score > 0, "top hit score must be > 0");
});

test("topK bounds the result length", () => {
  const m = createMockMem0();
  // Five memories that all overlap the query token "alpha".
  for (let i = 0; i < 5; i++) m.add({ text: `alpha record number ${i}` });

  const hits = m.search("alpha", 3);
  assert.equal(hits.length, 3);
});

test("no token overlap returns []; empty/whitespace query returns []", () => {
  const m = createMockMem0();
  m.add({ text: "decision about the router policy" });

  assert.deepEqual(m.search("xylophone zebra"), []);
  assert.deepEqual(m.search(""), []);
  assert.deepEqual(m.search("   \t\n "), []);
});

test("ranking: higher overlap ranks first", () => {
  const m = createMockMem0();
  m.add({ id: "low", text: "alpha only here" });
  m.add({ id: "high", text: "alpha and beta both present" });

  const hits = m.search("alpha beta");
  assert.equal(hits[0].memory.id, "high", "2/2 overlap must beat 1/2 overlap");
  assert.equal(hits[1].memory.id, "low");
  assert.ok(hits[0].score > hits[1].score);
});

test("ranking: equal scores tie-break by insertion order (stable)", () => {
  const m = createMockMem0();
  m.add({ id: "first", text: "gamma appears" });
  m.add({ id: "second", text: "gamma appears too" });

  const hits = m.search("gamma");
  assert.equal(hits[0].score, hits[1].score, "both are 1/1 overlap");
  assert.deepEqual(
    hits.map((h) => h.memory.id),
    ["first", "second"],
    "equal scores keep insertion order",
  );
});

test("tags are also matched by search", () => {
  const m = createMockMem0();
  m.add({ id: "tagged", text: "no keyword in body", tags: ["deployment", "prod"] });

  const hits = m.search("deployment");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memory.id, "tagged");
});

test("duplicate id upserts (overwrites) and does not consume a new insertion slot", () => {
  const m = createMockMem0();
  m.add({ id: "k", text: "original text" });
  const next = m.add({ text: "auto-id memory" });
  // The auto-id memory took slot mem-1, proving "k" consumed slot 0.
  assert.equal(next.id, "mem-1");

  // Upsert "k" with new content.
  const updated = m.add({ id: "k", text: "replacement text" });
  assert.equal(updated.text, "replacement text");

  // A subsequent auto-id add takes mem-2, proving the upsert consumed no slot.
  const after = m.add({ text: "another auto" });
  assert.equal(after.id, "mem-2");

  // Only the replacement is searchable; the original is gone.
  assert.deepEqual(m.search("original"), []);
  const hits = m.search("replacement");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].memory.id, "k");
});

test("add rejects missing/empty text", () => {
  const m = createMockMem0();
  assert.throws(() => m.add({ text: "" }), /non-empty string/);
  assert.throws(() => m.add({ text: "   " }), /non-empty string/);
  assert.throws(() => m.add({}), /non-empty string/);
});
