import { test } from "node:test";
import assert from "node:assert/strict";

import { createMockMem0 } from "./mem0-adapter.mjs";
import { recall } from "./recall.mjs";

/** Repo-wide token proxy, duplicated so the test is independent of the module. */
const proxy = (str) => Math.ceil(str.length / 4);

/** Seed a fresh mock with a handful of distinct memories. */
function seeded() {
  const m = createMockMem0();
  m.add({ id: "a", text: "router two-plane frontier subscription workhorse api", kind: "decision" });
  m.add({ id: "b", text: "toon encoding compresses token payloads for prompts", kind: "summary" });
  m.add({ id: "c", text: "boundary redaction strips secrets before send", kind: "decision" });
  m.add({ id: "d", text: "mem0 adapter deterministic keyword overlap search", kind: "summary" });
  m.add({ id: "e", text: "handover doc manual context continuity friction", kind: "pref" });
  return m;
}

test("focused context recalls the relevant memory and ranks it first", async () => {
  const m = seeded();
  const result = await recall(m, "toon encoding compresses token payloads", {});

  assert.ok(result.text.includes("toon encoding compresses token payloads"),
    "the relevant memory text should appear in the injection");
  assert.ok(result.used.length >= 1);
  assert.equal(result.used[0].id, "b", "most relevant memory ranks first");
  // First bullet in the text should be the top-ranked memory.
  const firstBulletLine = result.text.split("\n")[1];
  assert.ok(firstBulletLine.includes("toon encoding"));
});

test("header + bullet format is present and bullets are in rank order", async () => {
  const m = seeded();
  const result = await recall(m, "deterministic mem0 adapter search overlap", {});

  const lines = result.text.split("\n");
  assert.equal(lines[0], "## Recalled context", "header first");
  // Every non-header line is a formatted bullet: `- [kind] text`.
  for (const line of lines.slice(1)) {
    assert.match(line, /^- \[[^\]]+\] .+/, `bullet format: ${line}`);
  }
  // Rank order: used[] mirrors the order bullets appear in the text.
  const usedTexts = result.used.map((mem) => mem.text);
  const bulletTexts = lines.slice(1).map((l) => l.replace(/^- \[[^\]]+\] /, ""));
  assert.deepEqual(bulletTexts, usedTexts, "bullets follow used[] rank order");
});

test("token budget is always respected; a tiny budget drops later bullets", async () => {
  const m = seeded();
  // Query that matches multiple memories so several would be returned.
  const query = "decision summary token search context continuity adapter";
  const full = await recall(m, query, { topK: 5, maxTokens: 1000 });
  assert.ok(full.used.length >= 2, "baseline recalls multiple memories");

  const tight = await recall(m, query, { topK: 5, maxTokens: 12 });
  assert.ok(tight.tokens <= 12, `tokens ${tight.tokens} within budget`);
  assert.ok(tight.used.length < full.used.length,
    "a tight budget includes fewer memories than a generous one");
  assert.ok(tight.used.length >= 1, "still includes at least the top hit");
});

test("no matches / empty context returns an empty result", async () => {
  const m = seeded();
  assert.deepEqual(await recall(m, "zzz nonexistent quux", {}), { text: "", used: [], tokens: 0 });
  assert.deepEqual(await recall(m, "", {}), { text: "", used: [], tokens: 0 });
  assert.deepEqual(await recall(m, "   ", {}), { text: "", used: [], tokens: 0 });
  assert.deepEqual(await recall(m, null, {}), { text: "", used: [], tokens: 0 });
});

test("returned tokens equal the Math.ceil(len/4) proxy of result.text", async () => {
  const m = seeded();
  const result = await recall(m, "router frontier workhorse api plane", {});
  assert.equal(result.tokens, proxy(result.text));
  assert.equal(result.tokens, Math.ceil(result.text.length / 4));
});

test("very long single memory + tiny budget truncates the first bullet with an ellipsis", async () => {
  const m = createMockMem0();
  const longText = "supernova " + "context ".repeat(200) + "tail";
  m.add({ id: "big", text: longText.trim(), kind: "summary" });

  const maxTokens = 20;
  const result = await recall(m, "supernova context tail", { maxTokens });

  assert.ok(result.tokens <= maxTokens, `tokens ${result.tokens} within budget`);
  assert.ok(result.text.includes("…"), "truncated bullet ends with an ellipsis");
  assert.ok(result.text.startsWith("## Recalled context"), "header preserved");
  assert.equal(result.used.length, 1, "the single memory is counted as used");
  assert.ok(result.text.length < longText.length, "text was actually truncated");
});

test("array and { query } context forms both derive a working query", async () => {
  const m = seeded();
  const fromArray = await recall(m, ["toon", "encoding", "token"], {});
  const fromObj = await recall(m, { query: "toon encoding token" }, {});
  assert.ok(fromArray.used.some((mem) => mem.id === "b"));
  assert.ok(fromObj.used.some((mem) => mem.id === "b"));
});
