# agent-comms P2P mesh (exception routing)

A localhost TCP mesh for the ONE case default routing can't serve: a BLOCKED
worker needs a specific FACT from a peer pane, laterally, right now.

- **Exception-only scope.** The mesh serves lateral fact queries and nothing
  else. `isExceptionAllowed` rejects any message that isn't a well-formed
  `{type:"query", exception:true, ...}` — a `{type:"route", ...}` default-work
  message gets an error, not a hop.
- **Chain-of-command stays the default.** Normal work routing goes
  parent-through (up the chain, back down). The mesh never carries it; that is
  the whole point of the guard.
- **Fact, not full content.** A message carries a small `ask` (a fact request)
  and gets back a small `answer`. It never ships full content — this preserves
  the Reference > Compressed > Full invariant (pass a reference/fact, not the
  payload).
- **Protocol.** Newline-delimited JSON: one JSON object per line, `\n`
  terminated. Query → `{type:"query", exception:true, from, to, ask}`. Reply →
  `{type:"answer", from, to, ask, answer}` or `{type:"error", to, reason}`.
