// Hermetic unit tests for the Mem0 client: pure request/response mapping and
// input validation, plus injected-fetch behaviour that never touches a socket.
// The fake-server integration tests live in ./mem0-client.integration.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createMem0Client,
  toMem0AddBody,
  fromMem0SearchHit,
  toMem0SearchBody,
} from "./mem0-client.mjs";

// ---------------------------------------------------------------------------
// Pure mapping helpers — no network.
// ---------------------------------------------------------------------------

test("toMem0AddBody wraps text as a user message with infer:false and user_id", () => {
  const body = toMem0AddBody({ text: "chose approach B" }, "alice");
  assert.deepEqual(body.messages, [{ role: "user", content: "chose approach B" }]);
  assert.equal(body.user_id, "alice");
  assert.equal(body.infer, false, "must store verbatim, no LLM extraction");
  assert.equal("metadata" in body, false, "no metadata key when no kind/tags/meta");
});

test("toMem0AddBody places kind/tags/meta under metadata", () => {
  const body = toMem0AddBody(
    { text: "t", kind: "decision", tags: ["prod", "deploy"], meta: { sprint: 1 } },
    "u",
  );
  assert.deepEqual(body.metadata, {
    kind: "decision",
    tags: ["prod", "deploy"],
    meta: { sprint: 1 },
  });
  // tags is a copy, not the caller's array reference.
  const tags = ["x"];
  const b2 = toMem0AddBody({ text: "t", tags }, "u");
  b2.metadata.tags.push("y");
  assert.deepEqual(tags, ["x"], "caller tags must not be mutated");
});

test("toMem0SearchBody carries query, user_id and top_k", () => {
  assert.deepEqual(toMem0SearchBody("cascade", 3, "bob"), {
    query: "cascade",
    user_id: "bob",
    top_k: 3,
  });
});

test("fromMem0SearchHit reconstructs our memory shape + score", () => {
  const hit = {
    id: "abc-123",
    memory: "the cascade unblocks dependents",
    score: 0.87,
    metadata: { kind: "summary", tags: ["race"], meta: { n: 2 } },
  };
  assert.deepEqual(fromMem0SearchHit(hit), {
    memory: {
      id: "abc-123",
      text: "the cascade unblocks dependents",
      kind: "summary",
      tags: ["race"],
      meta: { n: 2 },
    },
    score: 0.87,
  });
});

test("fromMem0SearchHit defaults missing score to 0 and omits absent metadata keys", () => {
  const out = fromMem0SearchHit({ id: "i", memory: "bare" });
  assert.deepEqual(out, { memory: { id: "i", text: "bare" }, score: 0 });
});

// ---------------------------------------------------------------------------
// Validation + injected fetch — hermetic, no socket bound.
// ---------------------------------------------------------------------------

test("add validates text and createMem0Client validates baseUrl (no network)", async () => {
  assert.throws(() => createMem0Client({}), /baseUrl is required/);

  const client = createMem0Client({ baseUrl: "http://127.0.0.1:1", fetchImpl: async () => {
    throw new Error("fetch must not be called for invalid input");
  } });
  await assert.rejects(() => client.add({ text: "" }), /non-empty string/);
  await assert.rejects(() => client.add({}), /non-empty string/);
});

test("fetchImpl is injectable — the client uses it verbatim", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      async json() {
        return { results: [{ id: "inj-1", memory: "hi", event: "ADD" }] };
      },
    };
  };
  const client = createMem0Client({ baseUrl: "http://example.test", fetchImpl: fakeFetch });
  const stored = await client.add({ text: "hi" });
  assert.equal(stored.id, "inj-1");
  assert.equal(calls[0].url, "http://example.test/memories");
  assert.equal(calls[0].opts.method, "POST");
});
