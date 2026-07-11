// agent-comms P2P mesh — EXCEPTION routing only.
//
// A localhost TCP mesh so a BLOCKED worker can request a specific FACT from a
// peer pane. This is an EXCEPTION channel: the default is chain-of-command
// (parent-through) routing. The mesh REJECTS anything that looks like normal
// work-routing; it only serves lateral/exception fact queries. Messages carry
// a small ask (a fact), never full content.
//
// Protocol: newline-delimited JSON — one JSON object per line, `\n` terminated.
//
// HARDENING (Step 8.10): a shared host is not trusted just because it is local.
// The node enforces, in order:
//   1. connection cap        — refuse (drop) connections beyond maxConnections
//   2. message-size cap       — a line/buffer over maxMessageBytes is rejected
//                               and the socket dropped (no unbounded buffering)
//   3. per-run auth token     — when `authToken` is set, every query must carry
//                               a matching `token` (timing-safe compare) or it
//                               is rejected as "unauthorized" and onQuery is
//                               NEVER called (opt-in: omit for trusted single-
//                               host use so existing callers are unaffected)
//   4. schema gate            — isExceptionAllowed (unchanged)
//   5. concurrency cap        — at most maxInFlight onQuery calls at once
// Replies echo the request's correlation `id`, and error `reason`s are short,
// fixed, sanitized strings — a peer never learns handler internals.

import net from "node:net";
import { timingSafeEqual } from "node:crypto";

export const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024; // 64 KiB — facts are small
export const DEFAULT_MAX_CONNECTIONS = 32;
export const DEFAULT_MAX_IN_FLIGHT = 16;
// A fact query settles in milliseconds; anything idle far longer is a silent
// slot-holder. Reclaiming it stops the connection cap from becoming a cheap DoS
// (a hostile local process holding every slot open forever).
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

// Error reasons are bounded so a hostile/broken peer cannot pull large or
// internal strings back out of the node.
const MAX_REASON_LEN = 200;
function sanitizeReason(reason) {
  const s = typeof reason === "string" ? reason : String(reason);
  return s.length > MAX_REASON_LEN ? s.slice(0, MAX_REASON_LEN) : s;
}

function errorReply(id, reason, to) {
  const reply = { type: "error", reason: sanitizeReason(reason) };
  if (id !== undefined) reply.id = id;
  if (to !== undefined) reply.to = to;
  return reply;
}

// Constant-time token comparison that never throws on length mismatch.
function tokenMatches(expected, got) {
  if (typeof expected !== "string" || typeof got !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
 * On each complete newline-delimited line: parse JSON; enforce the hardening
 * chain above; if a query passes, call onQuery({ from, ask }) and reply with
 * the answer (echoing the request `id`).
 *
 * @param {object} opts
 * @param {string} opts.name             this node's name
 * @param {number} [opts.port=0]         0 → OS-assigned port
 * @param {string} [opts.host="127.0.0.1"]
 * @param {(q:{from:any, ask:string}) => any} opts.onQuery
 * @param {string} [opts.authToken]      per-run shared secret; when set, queries
 *                                        must carry a matching `token`
 * @param {number} [opts.maxMessageBytes=65536]
 * @param {number} [opts.maxConnections=32]
 * @param {number} [opts.maxInFlight=16]
 * @returns {Promise<{name:string, port:number, close:() => Promise<void>}>}
 */
export function startNode({
  name,
  port = 0,
  host = "127.0.0.1",
  onQuery,
  authToken,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  maxInFlight = DEFAULT_MAX_IN_FLIGHT,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    // Track live sockets so close() can force-drop them — plain net.Server has
    // no closeAllConnections(), and server.close() otherwise waits forever for
    // peers to hang up, hanging the process.
    const sockets = new Set();
    let inFlight = 0;

    const server = net.createServer((socket) => {
      // (1) connection cap — refuse and drop beyond the limit, before any work.
      if (sockets.size >= maxConnections) {
        try {
          socket.destroy();
        } catch {
          /* already gone */
        }
        return;
      }
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));

      // Reclaim a slot if the peer goes idle (the timer resets on any socket
      // activity, so an in-progress query is never cut off mid-flight).
      if (idleTimeoutMs > 0) {
        socket.setTimeout(idleTimeoutMs, () => socket.destroy());
      }

      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");

        // (2) size cap — an unterminated message that grows past the limit is a
        // memory-exhaustion attempt: reject and drop the connection.
        if (
          buffer.indexOf("\n") === -1 &&
          Buffer.byteLength(buffer, "utf8") > maxMessageBytes
        ) {
          write(socket, errorReply(undefined, "message too large"));
          socket.destroy();
          return;
        }

        // Handle partial/multiple lines with a buffer: process every complete
        // `\n`-terminated line, keep any trailing partial in the buffer.
        let idx;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (Buffer.byteLength(line, "utf8") > maxMessageBytes) {
            write(socket, errorReply(undefined, "message too large"));
            socket.destroy();
            return;
          }
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

        const id = msg && typeof msg === "object" ? msg.id : undefined;
        const from = msg && typeof msg === "object" ? msg.from : undefined;

        // (3) auth — when a token is required, an absent/wrong token is rejected
        // WITHOUT running onQuery, and the reason is deliberately generic.
        if (authToken !== undefined && !tokenMatches(authToken, msg && msg.token)) {
          write(socket, errorReply(id, "unauthorized", from));
          return;
        }

        // (4) schema gate.
        if (!isExceptionAllowed(msg)) {
          write(
            socket,
            errorReply(
              id,
              "mesh is exception-only; use chain-of-command for default routing",
              from,
            ),
          );
          return;
        }

        // (5) concurrency cap — shed load rather than unbounded fan-in.
        if (inFlight >= maxInFlight) {
          write(socket, errorReply(id, "node busy: too many in-flight queries", from));
          return;
        }

        inFlight++;
        try {
          const answer = await onQuery({ from: msg.from, ask: msg.ask });
          write(socket, {
            type: "answer",
            id,
            from: name,
            to: msg.from,
            ask: msg.ask,
            answer,
          });
        } catch {
          // Sanitized — never forward the handler's internal error text.
          write(socket, errorReply(id, "query handler error", msg.from));
        } finally {
          inFlight--;
        }
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

// Module-level counter so askPeer can mint a correlation id when the caller
// does not supply one. Deterministic, no randomness.
let askSeq = 0;

/**
 * Ask a specific FACT of a peer node over the mesh.
 *
 * Sends {type:"query", exception:true, from, to, ask, id, token?}\n and:
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
 * @param {string} [opts.authToken]  presented as `token` when set
 * @param {string} [opts.id]         correlation id (auto-generated if omitted)
 * @param {number} [opts.timeoutMs=2000]
 * @returns {Promise<any>} the peer's answer
 */
export function askPeer({
  host = "127.0.0.1",
  port,
  from,
  to,
  ask,
  authToken,
  id,
  timeoutMs = 2000,
  maxReplyBytes = DEFAULT_MAX_MESSAGE_BYTES,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const corrId = id !== undefined ? id : `${from ?? "?"}:${askSeq++}`;
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
      if (idx === -1) {
        // Bound client-side buffering: a hostile/broken peer streaming a reply
        // with no newline must not grow memory unboundedly for the timeout.
        if (Buffer.byteLength(buffer, "utf8") > maxReplyBytes) {
          finish(() => reject(new Error("reply too large")));
        }
        return; // otherwise wait for a complete line
      }
      const line = buffer.slice(0, idx);

      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        finish(() => reject(new Error(`invalid reply from peer: ${line}`)));
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
      const query = { type: "query", exception: true, from, to, ask, id: corrId };
      if (authToken !== undefined) query.token = authToken;
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
