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

**Note:** the guard itself stays a pure, deterministic truncate+marker seam (no
I/O, clock, or randomness). The REAL semantic tiers now live in sibling modules
that wrap it degrade-safely (S03 / 3.4–3.5 pilots):

## rtk-compress.mjs — real "compressed" tier (rtk)

- `rtkCompress(command, {cwd})` runs an rtk-proxy-style command (first token = an
  rtk subcommand, e.g. `git log --stat`, `test node --test`) through rtk 0.43.0
  and returns the compressed output.
- `compressOrFallback(command, opts)` is degrade-safe: rtk if available, else the
  raw command + this guard's truncate stub. **Never throws.**
- Measured 81–99.6% reduction on this repo — see `metrics/rtk-vs-raw.md`.
- Tests: deterministic fallback path (rtk forced absent) + a live rtk test that
  self-skips when `rtk` is off PATH.

## cce-retrieve.mjs — retrieval degrade chain (CCE → file-path → compressed)

- `retrieve(query, opts)` tries CCE (code-context-engine) semantic retrieval,
  else a plain file-path reference (grep-ranked, filename-boosted), else the
  compressed tier via `compressOrFallback`. **Never throws.**
- CCE runs local embeddings (BAAI/bge-small-en-v1.5, no Ollama needed); index in
  `~/.cce`. Measured 19–55% per-query token savings.
- Tests: deterministic fallback ordering (CCE forced off) + a live CCE test that
  self-skips when `cce` is absent or nothing is indexed.

See `docs/context-tooling-decision.md` for the keep-both verdict (rtk ADOPT,
CCE PROVISIONAL).
