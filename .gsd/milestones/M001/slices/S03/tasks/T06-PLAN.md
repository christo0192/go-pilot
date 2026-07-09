# T06 — agent-comms P2P mesh (exception routing) (PLAN Step 3.7)

## Goal
Stand up a localhost TCP mesh bridging panes so a BLOCKED worker can request a specific fact from a
peer pane — but restrict this to lateral/exception clarification. Chain-of-command (parent-through
routing) stays the default (D9/#4); P2P is the escape hatch, not the norm.

## Design (Node ESM, zero deps — node:net)
- `src/comms/mesh.mjs`:
  - `startNode({ name, port?, onQuery })` → a TCP server that accepts newline-delimited JSON messages
    `{ type:"query", from, to, ask }`, calls `onQuery({from, ask})` → answer, replies
    `{ type:"answer", from, to, ask, answer }`. Returns `{ port, close() }`.
  - `askPeer({ host?, port, from, to, ask, timeoutMs? })` → connects, sends a query, resolves the answer;
    rejects on timeout.
  - `isExceptionAllowed(msg)` — guard: only `type:"query"` marked as an exception/lateral request is
    accepted; anything that looks like default work-routing is rejected with `{type:"error", reason}`.
    (Default routing must NOT flow over this mesh.)
- Keep messages small (this is Reference-tier: ask for a fact, not full content — ties to T03 invariant).

## Deliverables
1. `src/comms/mesh.mjs` — server + client + exception guard.
2. `src/comms/mesh.test.mjs` (`node --test`): loopback — start a peer node with an `onQuery` that answers
   a fact; a second party `askPeer` and asserts the returned answer; assert a non-exception/default-routing
   message is rejected by the guard; assert `askPeer` rejects on timeout when no peer answers. Use ephemeral
   ports (port 0 / OS-assigned); close all sockets in teardown so the test exits cleanly.
3. `src/comms/README.md` — ~8 lines: exception-only scope, chain-of-command remains default, fact-not-content.

## Acceptance
- `node --test` green (all prior suites + comms). Zero new deps.
- A blocked worker can request a specific fact from a peer; default routing still goes parent-through
  (proven by the guard rejecting non-exception messages). No hanging sockets after tests.

## Out of scope
Real pane wiring / herdr integration; auth; multi-hop routing. Do NOT modify package.json.
