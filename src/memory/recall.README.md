# recall — session-start recall seam (PLAN Step 4.5)

`recall(adapter, context, opts)` queries Tier-2 memory (the Mem0 `{ add, search }`
adapter) for the top-k memories relevant to the current session focus and formats
them into a small, bounded injection block — the automatic replacement for the
manual handover doc.

- **Query**: derived from `context` (a string, an array of strings joined with
  spaces, or `{ query }`); empty/no-match → `{ text:"", used:[], tokens:0 }`.
- **Format**: a `## Recalled context` header then one `- [kind] text` bullet per
  memory, most-relevant first.
- **Budget**: `opts.maxTokens ?? 300` using the repo token proxy `Math.ceil(len/4)`.
  Bullets are added in rank order until the next would exceed the budget, then we
  STOP (no partial bullets). If even the top bullet overflows, its text is
  truncated with an ellipsis. `tokens <= maxTokens` always holds.
- Real cross-session comparison vs the old handover is DEFERRED until Docker/Mem0
  exist; this seam is built and tested against the deterministic mock adapter.
