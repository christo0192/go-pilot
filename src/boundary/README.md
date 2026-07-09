# Boundary guard — Reference > Compressed > Full

**Invariant:** content crossing a pane boundary must be a reference/pointer or a
compressed summary by default — NEVER raw full content unless explicitly justified.

**Ladder (cheapest first):** `reference` (a pointer/handle) > `compressed` (a
summary) > `full` (raw content). Prefer the leftmost tier that still conveys intent.

**Rules:** `reference` and `compressed` pass through untouched. `full` passes only
when it carries a non-empty `justification` string, or when `content.length <=`
threshold (`DEFAULT_THRESHOLD = 800`, overridable via `opts.threshold`).

**Downgrade:** an unjustified `full` payload over threshold is downgraded — to
`reference` if a `ref` is available, otherwise `compressed` (truncate to threshold
plus a ` …[+N chars elided]` marker). Downgraded results are `flagged: true`.

**Note:** "compressed" here is a naive truncate+marker seam — real semantic
compressors (rtk / CCE / LLMLingua-2) are deferred. The guard is pure and
deterministic (no I/O, clock, or randomness).
