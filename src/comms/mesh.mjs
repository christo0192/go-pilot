// agent-comms P2P mesh — EXCEPTION routing only.
//
// A localhost TCP mesh so a BLOCKED worker can request a specific FACT from a
// peer pane. This is an EXCEPTION channel: the default is chain-of-command
// (parent-through) routing. The mesh REJECTS anything that looks like normal
// work-routing; it only serves lateral/exception fact queries. Messages carry
// a small ask (a fact), never full content.
//
// Protocol: newline-delimited JSON — one JSON object per line, `\n` terminated.

import net from "node:net";

/**
 * Guard that keeps default routing OFF the mesh.
 *
 * Returns true ONLY for a well-formed exception query:
 *   - msg.type === "query"
 *   - msg.exception === true
 *   - non-empty string msg.ask
 *   - msg.from present
 *   - msg.to present
 *
 * Anything else (missing exception:true, wrong type such as a
 * {type:"route", ...} default-routing message, empty ask, etc.) → false.
 *
 * @param {any} msg
 * @returns {boolean}
 */
export function isExceptionAllowed(msg) {
  return (
    !!msg &&
    typeof msg === "object" &&
    msg.type === "query" &&
    msg.exception === true &&
    typeof msg.ask === "string" &&
    msg.ask.length > 0 &&
    msg.from !== undefined &&
    msg.from !== null &&
    msg.from !== "" &&
    msg.to !== undefined &&
    msg.to !== null &&
    msg.to !== ""
  );
}

/**
 * Start a TCP mesh node.
 *
 * On each complete newline-delimited line: parse JSON; if isExceptionAllowed is
 * false → reply with an error and do NOT call onQuery; else call
 * onQuery({ from, ask }) and reply with the answer.
 *
 * @param {object} opts
 * @param {string} opts.name           this node's name
 * @param {number} [opts.port=0]       0 → OS-assigned port
 * @param {string} [opts.host="127.0.0.1"]
 * @param {(q:{from:any, ask:string}) => any} opts.onQuery
 * @returns {Promise<{name:string, port:number, close:() => Promise<void>}>}
 */
export function startNode({ name, port = 0, host = "127.0.0.1", onQuery }) {
  return new Promise((resolve, reject) => {
    // Track live sockets so close() can force-drop them — plain net.Server has
    // no closeAllConnections(), and server.close() otherwise waits forever for
    // peers to hang up, hanging the process.
    const sockets = new Set();

    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));

      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");

        // Handle partial/multiple lines with a buffer: process every complete
        // `\n`-terminated line, keep any trailing partial in the buffer.
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.trim() === "") continue;
          handleLine(line);
        }
      });

      // Swallow socket errors (e.g. peer destroys the connection) so a broken
      // client cannot crash the node.
      socket.on("error", () => {});

      async function handleLine(line) {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          // Unparseable line is not a valid exception query.
          msg = null;
        }

        if (!isExceptionAllowed(msg)) {
          const reply = {
            type: "error",
            to: msg && typeof msg === "object" ? msg.from : undefined,
            reason:
              "mesh is exception-only; use chain-of-command for default routing",
          };
          write(socket, reply);
          return;
        }

        let answer;
        try {
          answer = await onQuery({ from: msg.from, ask: msg.ask });
        } catch (err) {
          write(socket, {
            type: "error",
            to: msg.from,
            reason: `onQuery failed: ${err && err.message ? err.message : String(err)}`,
          });
          return;
        }

        write(socket, {
          type: "answer",
          from: name,
          to: msg.from,
          ask: msg.ask,
          answer,
        });
      }
    });

    server.on("error", reject);

    server.listen(port, host, () => {
      const boundPort = server.address().port;
      resolve({
        name,
        port: boundPort,
        close: () =>
          new Promise((res) => {
            // Force-drop any lingering accepted connections first, otherwise
            // server.close() waits indefinitely for peers to hang up and the
            // process never exits cleanly.
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            server.close(() => res());
          }),
      });
    });
  });
}

/**
 * Ask a specific FACT of a peer node over the mesh.
 *
 * Sends {type:"query", exception:true, from, to, ask}\n and:
 *   - resolves with the parsed reply's `answer` on a {type:"answer"} reply,
 *   - rejects with an Error carrying `.reason` on a {type:"error"} reply,
 *   - rejects on timeout.
 * The socket is always closed on settle.
 *
 * @param {object} opts
 * @param {string} [opts.host="127.0.0.1"]
 * @param {number} opts.port
 * @param {any} opts.from
 * @param {any} opts.to
 * @param {string} opts.ask
 * @param {number} [opts.timeoutMs=2000]
 * @returns {Promise<any>} the peer's answer
 */
export function askPeer({
  host = "127.0.0.1",
  port,
  from,
  to,
  ask,
  timeoutMs = 2000,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`askPeer timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    // Always clear the timer + destroy the socket exactly once on settle.
    function finish(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    }

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const idx = buffer.indexOf("\n");
      if (idx === -1) return; // wait for a complete line
      const line = buffer.slice(0, idx);

      let reply;
      try {
        reply = JSON.parse(line);
      } catch (err) {
        finish(() =>
          reject(new Error(`invalid reply from peer: ${line}`)),
        );
        return;
      }

      if (reply && reply.type === "answer") {
        finish(() => resolve(reply.answer));
      } else if (reply && reply.type === "error") {
        const err = new Error(reply.reason || "mesh error");
        err.reason = reply.reason;
        finish(() => reject(err));
      } else {
        finish(() =>
          reject(new Error(`unexpected reply type: ${reply && reply.type}`)),
        );
      }
    });

    socket.on("error", (err) => {
      finish(() => reject(err));
    });

    socket.connect(port, host, () => {
      const query = { type: "query", exception: true, from, to, ask };
      socket.write(JSON.stringify(query) + "\n");
    });
  });
}

function write(socket, obj) {
  try {
    socket.write(JSON.stringify(obj) + "\n");
  } catch {
    // Peer may have already gone; nothing to do.
  }
}
