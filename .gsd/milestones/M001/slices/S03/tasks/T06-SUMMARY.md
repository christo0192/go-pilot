---
task: T06
title: agent-comms P2P mesh — exception routing (PLAN Step 3.7)
status: complete
duration: ~9min
files_changed:
  - src/comms/mesh.mjs
  - src/comms/mesh.test.mjs
  - src/comms/README.md
verification: node_test_42_pass, clean_exit_no_hang, zero_deps
---

localhost TCP mesh (`node:net`, newline-JSON) so a blocked worker can ask a peer for a specific FACT.
`isExceptionAllowed` guard admits ONLY `{type:"query", exception:true, from, to, ask}` — default
work-routing (`{type:"route",...}` / missing `exception:true`) is rejected with an error reply and never
reaches `onQuery`, keeping chain-of-command the default (D9/#4). `askPeer` resolves the answer or rejects
on error/timeout, destroying its socket on every settle path. Fact-not-content ties to the T03 invariant.

Real bug found+fixed by the worker: `server.closeAllConnections()` is `http.Server`-only — on plain
`net.Server` it's `undefined`, so accepted sockets leaked and `close()` hung. Fix: track accepted sockets
in a Set and `.destroy()` them before `close()`. Verified: `node --test` 42/42 AND process exits rc=0
with no hanging handles. Zero deps. (→ KNOWLEDGE)
