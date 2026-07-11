import { test, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { isExceptionAllowed, startNode, askPeer } from "./mesh.mjs";

// Track everything that must be torn down so `node --test` exits with no
// hanging handles.
const openNodes = [];
const rawServers = [];

// Create a raw net.Server that self-tracks its accepted sockets, so teardown
// can force-drop them (plain net.Server has no closeAllConnections()).
function trackedServer(connectionListener) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    if (connectionListener) connectionListener(socket);
  });
  server.destroyAll = () => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };
  rawServers.push(server);
  return server;
}

// Send one raw payload and resolve with the first reply object, or
// { closed: true } if the node drops the connection before replying, or
// { timeout: true } if nothing arrives.
function rawRequest(port, payload, { terminate = true, timeoutMs = 1000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, "127.0.0.1", () => {
      socket.write(terminate ? payload + "\n" : payload);
    });
    let buffer = "";
    let done = false;
    const settle = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      socket.destroy();
      resolve(v);
    };
    const t = setTimeout(() => settle({ timeout: true }), timeoutMs);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx !== -1) settle(JSON.parse(buffer.slice(0, idx)));
    });
    socket.on("close", () => settle({ closed: true }));
    socket.on("error", () => settle({ closed: true }));
  });
}

after(async () => {
  for (const node of openNodes) {
    await node.close();
  }
  for (const server of rawServers) {
    // Force-drop lingering connections so server.close() resolves and the test
    // process exits with no hanging handles.
    if (server.destroyAll) server.destroyAll();
    await new Promise((res) => server.close(() => res()));
  }
});

test("happy path: askPeer returns the exact fact the peer answers", async () => {
  const node = await startNode({
    name: "peerA",
    port: 0,
    onQuery: ({ ask }) => {
      if (ask === "build:status") return "green";
      return "unknown";
    },
  });
  openNodes.push(node);

  const answer = await askPeer({
    port: node.port,
    from: "worker-1",
    to: "peerA",
    ask: "build:status",
  });

  assert.equal(answer, "green");
});

test("guard unit: isExceptionAllowed classifies messages correctly", () => {
  // Default-routing message → false (keeps normal routing off the mesh).
  assert.equal(
    isExceptionAllowed({
      type: "route",
      from: "a",
      to: "b",
      task: "do the thing",
    }),
    false,
  );

  // Query missing exception:true → false.
  assert.equal(
    isExceptionAllowed({ type: "query", from: "a", to: "b", ask: "fact?" }),
    false,
  );

  // Empty ask → false.
  assert.equal(
    isExceptionAllowed({
      type: "query",
      exception: true,
      from: "a",
      to: "b",
      ask: "",
    }),
    false,
  );

  // Proper exception query → true.
  assert.equal(
    isExceptionAllowed({
      type: "query",
      exception: true,
      from: "a",
      to: "b",
      ask: "fact?",
    }),
    true,
  );
});

test("guard integration: non-exception message yields error and onQuery is never called", async () => {
  let onQueryCalls = 0;
  const node = await startNode({
    name: "peerB",
    port: 0,
    onQuery: () => {
      onQueryCalls++;
      return "should-not-happen";
    },
  });
  openNodes.push(node);

  // Send a default-routing message directly over the wire.
  const reply = await new Promise((resolve, reject) => {
    const socket = net.createConnection(node.port, "127.0.0.1", () => {
      const routeMsg = {
        type: "route",
        from: "worker-1",
        to: "peerB",
        task: "route this normally",
      };
      socket.write(JSON.stringify(routeMsg) + "\n");
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx !== -1) {
        socket.destroy();
        resolve(JSON.parse(buffer.slice(0, idx)));
      }
    });
    socket.on("error", reject);
  });

  assert.equal(reply.type, "error");
  assert.match(reply.reason, /exception-only/);
  assert.equal(onQueryCalls, 0, "onQuery must never be called for non-exception traffic");
});

test("timeout: askPeer rejects when the peer never answers", async () => {
  // Raw server that accepts connections but never replies.
  const silent = trackedServer(() => {
    /* accept, hold open, never write */
  });
  await new Promise((res) => silent.listen(0, "127.0.0.1", res));
  const port = silent.address().port;

  await assert.rejects(
    () =>
      askPeer({
        port,
        from: "worker-1",
        to: "ghost",
        ask: "are-you-there",
        timeoutMs: 150,
      }),
    /timed out/,
  );
});

test("error reply: askPeer rejects with a populated .reason on {type:'error'}", async () => {
  // Raw server that always replies with an error line, regardless of input.
  const rejecting = trackedServer((socket) => {
    socket.on("data", () => {
      socket.write(
        JSON.stringify({
          type: "error",
          to: "worker-1",
          reason: "mesh is exception-only; use chain-of-command for default routing",
        }) + "\n",
      );
    });
  });
  await new Promise((res) => rejecting.listen(0, "127.0.0.1", res));
  const port = rejecting.address().port;

  const err = await askPeer({
    port,
    from: "worker-1",
    to: "peerC",
    ask: "fact",
    timeoutMs: 500,
  }).then(
    () => null,
    (e) => e,
  );

  assert.ok(err instanceof Error, "askPeer should reject on an error reply");
  assert.match(err.reason, /exception-only/);
});

// --- Step 8.10 hardening ---------------------------------------------------

test("auth: a peer without the token is rejected (unauthorized), onQuery never runs", async () => {
  let calls = 0;
  const node = await startNode({
    name: "sec",
    port: 0,
    authToken: "s3cret",
    onQuery: () => {
      calls++;
      return "ok";
    },
  });
  openNodes.push(node);

  const err = await askPeer({ port: node.port, from: "w", to: "sec", ask: "fact" }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof Error, "unauthenticated query must reject");
  assert.match(err.reason, /unauthorized/);
  assert.equal(calls, 0, "onQuery must not run for an unauthorized peer");
});

test("auth: the correct token is accepted", async () => {
  const node = await startNode({
    name: "sec2",
    port: 0,
    authToken: "s3cret",
    onQuery: ({ ask }) => (ask === "fact" ? "yes" : "no"),
  });
  openNodes.push(node);

  const ans = await askPeer({
    port: node.port,
    from: "w",
    to: "sec2",
    ask: "fact",
    authToken: "s3cret",
  });
  assert.equal(ans, "yes");
});

test("auth: a wrong token is rejected (unauthorized)", async () => {
  let calls = 0;
  const node = await startNode({
    name: "sec3",
    port: 0,
    authToken: "s3cret",
    onQuery: () => {
      calls++;
      return "ok";
    },
  });
  openNodes.push(node);

  const err = await askPeer({
    port: node.port,
    from: "w",
    to: "sec3",
    ask: "fact",
    authToken: "wrong-token",
  }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof Error);
  assert.match(err.reason, /unauthorized/);
  assert.equal(calls, 0);
});

test("size cap: an oversized message is rejected and onQuery never runs", async () => {
  let calls = 0;
  const node = await startNode({
    name: "big",
    port: 0,
    maxMessageBytes: 40,
    onQuery: () => {
      calls++;
      return "x";
    },
  });
  openNodes.push(node);

  const huge = JSON.stringify({
    type: "query",
    exception: true,
    from: "w",
    to: "big",
    ask: "A".repeat(500),
  });
  const reply = await rawRequest(node.port, huge);
  assert.equal(reply.type, "error");
  assert.match(reply.reason, /too large/);
  assert.equal(calls, 0, "an oversized message must never reach onQuery");
});

test("connection cap: connections beyond maxConnections are dropped", async () => {
  const node = await startNode({
    name: "cap",
    port: 0,
    maxConnections: 1,
    onQuery: () => "ok",
  });
  openNodes.push(node);

  // Hold one connection open to fill the single slot.
  const held = net.createConnection(node.port, "127.0.0.1");
  held.on("error", () => {});
  await new Promise((res) => held.once("connect", res));

  const second = await rawRequest(
    node.port,
    JSON.stringify({ type: "query", exception: true, from: "w", to: "cap", ask: "x" }),
  );
  held.destroy();

  assert.notEqual(second.type, "answer", "an over-cap connection must not be served");
  assert.equal(second.closed, true, "the over-cap connection is dropped");
});

test("correlation id is echoed back on the reply", async () => {
  const node = await startNode({ name: "corr", port: 0, onQuery: () => "pong" });
  openNodes.push(node);

  const reply = await rawRequest(
    node.port,
    JSON.stringify({
      type: "query",
      exception: true,
      from: "w",
      to: "corr",
      ask: "ping",
      id: "corr-123",
    }),
  );
  assert.equal(reply.type, "answer");
  assert.equal(reply.id, "corr-123", "the request id is echoed on the reply");
  assert.equal(reply.answer, "pong");
});

test("idle connections are reclaimed so a silent hold cannot lock out the slots", async () => {
  const node = await startNode({
    name: "idle",
    port: 0,
    idleTimeoutMs: 120,
    onQuery: () => "ok",
  });
  openNodes.push(node);

  // Open a connection and send nothing — the node must reclaim it on idle.
  const closed = await new Promise((resolve) => {
    const s = net.createConnection(node.port, "127.0.0.1");
    s.on("error", () => {});
    s.on("close", () => resolve(true));
  });
  assert.equal(closed, true, "an idle connection is dropped by the node");
});

test("askPeer rejects an oversized peer reply (client-side size cap)", async () => {
  // A hostile peer that streams a reply with no newline, forever.
  const flooder = trackedServer((socket) => {
    socket.on("data", () => socket.write("Z".repeat(500)));
  });
  await new Promise((res) => flooder.listen(0, "127.0.0.1", res));
  const port = flooder.address().port;

  const err = await askPeer({
    port,
    from: "w",
    to: "x",
    ask: "fact",
    maxReplyBytes: 50,
    timeoutMs: 500,
  }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof Error);
  assert.match(err.message, /reply too large/);
});

test("handler errors are sanitized — internal message never leaks to the peer", async () => {
  const node = await startNode({
    name: "boom",
    port: 0,
    onQuery: () => {
      throw new Error("SECRET internal dsn=postgres://user:pw@host leaked");
    },
  });
  openNodes.push(node);

  const err = await askPeer({ port: node.port, from: "w", to: "boom", ask: "fact" }).then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof Error);
  assert.match(err.reason, /query handler error/);
  assert.doesNotMatch(err.reason, /SECRET|dsn|postgres/, "no internal detail is forwarded");
});
