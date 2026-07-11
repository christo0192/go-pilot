// Integration-shape tests for the Mem0 client — a FAKE Mem0 server on an
// ephemeral loopback port. Proves the client sends the RIGHT method/path/body
// and parses the response back into our contract. No real Docker/Mem0 required,
// but it binds a socket, so it lives outside the hermetic unit bucket.
// Pure mapping-helper tests live in ./mem0-client.test.mjs.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createMem0Client } from "./mem0-client.mjs";

/**
 * Spin up a fake Mem0 server. `handler(req, bodyObj)` returns
 * { status, json } for each request; the harness records what it received.
 */
function startFakeMem0(handler) {
  const received = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const bodyObj = raw ? JSON.parse(raw) : undefined;
      received.push({ method: req.method, path: req.url, body: bodyObj });
      const { status, json } = handler(req, bodyObj);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, received, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const servers = [];
after(() => {
  // Ensure every fake server is closed so the test process exits cleanly.
  for (const s of servers) s.close();
});

test("add: sends POST /memories with the mapped body and returns stored memory + Mem0 id", async () => {
  const fake = await startFakeMem0((req, body) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/memories");
    assert.equal(body.infer, false);
    assert.equal(body.messages[0].content, "chose approach B for the race");
    return {
      status: 200,
      json: { results: [{ id: "srv-uuid-1", memory: body.messages[0].content, event: "ADD" }] },
    };
  });
  servers.push(fake.server);

  const client = createMem0Client({ baseUrl: fake.baseUrl, userId: "alice" });
  const stored = await client.add({ text: "chose approach B for the race", kind: "decision" });

  assert.equal(stored.id, "srv-uuid-1", "id comes from the Mem0 response");
  assert.equal(stored.text, "chose approach B for the race");
  assert.equal(stored.kind, "decision");
  assert.equal(fake.received.length, 1);
  assert.equal(fake.received[0].body.user_id, "alice");
});

test("search: sends POST /search and parses results into ranked contract hits", async () => {
  const fake = await startFakeMem0((req, body) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/search");
    assert.equal(body.query, "cascade");
    assert.equal(body.top_k, 5);
    // Return deliberately unsorted to prove the client sorts by score desc.
    return {
      status: 200,
      json: {
        results: [
          { id: "lo", memory: "low relevance", score: 0.2, metadata: {} },
          { id: "hi", memory: "cascade unblocks dependents", score: 0.9, metadata: { kind: "summary" } },
        ],
      },
    };
  });
  servers.push(fake.server);

  const client = createMem0Client({ baseUrl: fake.baseUrl });
  const hits = await client.search("cascade");

  assert.equal(hits.length, 2);
  assert.equal(hits[0].memory.id, "hi", "highest score first");
  assert.equal(hits[0].memory.kind, "summary");
  assert.equal(hits[0].score, 0.9);
  assert.equal(hits[1].memory.id, "lo");
});

test("search: topK bounds the returned length", async () => {
  const fake = await startFakeMem0(() => ({
    status: 200,
    json: {
      results: [
        { id: "a", memory: "one", score: 0.9 },
        { id: "b", memory: "two", score: 0.8 },
        { id: "c", memory: "three", score: 0.7 },
      ],
    },
  }));
  servers.push(fake.server);

  const client = createMem0Client({ baseUrl: fake.baseUrl });
  const hits = await client.search("anything", 2);
  assert.equal(hits.length, 2);
});

test("search: empty result set -> []", async () => {
  const fake = await startFakeMem0(() => ({ status: 200, json: { results: [] } }));
  servers.push(fake.server);

  const client = createMem0Client({ baseUrl: fake.baseUrl });
  assert.deepEqual(await client.search("nothing matches"), []);
});

test("search: empty/whitespace query short-circuits to [] without hitting the server", async () => {
  const fake = await startFakeMem0(() => ({ status: 500, json: { error: "should not be called" } }));
  servers.push(fake.server);

  const client = createMem0Client({ baseUrl: fake.baseUrl });
  assert.deepEqual(await client.search(""), []);
  assert.deepEqual(await client.search("   \t "), []);
  assert.equal(fake.received.length, 0, "no request should be sent for empty query");
});

test("non-2xx response causes the client to throw a clear error", async () => {
  const fake = await startFakeMem0(() => ({ status: 401, json: { detail: "unauthorized" } }));
  servers.push(fake.server);

  const client = createMem0Client({ baseUrl: fake.baseUrl });
  await assert.rejects(() => client.add({ text: "x" }), /Mem0 POST \/memories failed: 401/);
  await assert.rejects(() => client.search("q"), /Mem0 POST \/search failed: 401/);
});
