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
