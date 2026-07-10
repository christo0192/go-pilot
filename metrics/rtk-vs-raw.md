# rtk vs raw — CLI-output compression (S03 / 3.4)

**Tool:** `rtk` 0.43.0 (github.com/rtk-ai/rtk) — single Rust binary CLI proxy that
filters/summarizes dev-command output before it hits an LLM context.

**Install:** prebuilt static binary, user-local (no sudo, no cargo).
Downloaded `rtk-x86_64-unknown-linux-musl.tar.gz` from the `v0.43.0` GitHub
release, installed to `~/.local/bin/rtk`. Verified: `rtk --version` → `rtk 0.43.0`.

**Measured on THIS repo** (Go-pilot, WSL Ubuntu, node v22). Token proxy = chars/4.

| Command | Raw chars (~tok) | rtk chars (~tok) | Reduction |
|---|---|---|---|
| `git log --stat -n 20` (vs `rtk git log --stat -n 20`) | 31,848 (~7,962) | 5,996 (~1,499) | **81.2%** |
| `git log -n 20` (vs `rtk pipe -f git-log`) | 17,369 (~4,342) | 250 (~62) | **98.6%** |
| `node --test` full suite (vs `rtk test node --test`) | 24,991 (~6,247) | 102 (~25) | **99.6%** |

All three land in / above the vendor's advertised 60–90% band. The biggest wins
are on repetitive, structured output (test TAP streams, one-line git history)
where rtk collapses to a summary + only-failures view.

## Notes / honest caveats

- **rtk works best as a proxy**, i.e. it must run the command itself
  (`rtk git log`, `rtk test node --test`) so it can apply a command-specific
  filter. `rtk pipe` (feeding raw stdout on stdin) with the *default* filter did
  **not** compress `node --test` output — you must name a matching filter. Our
  wiring therefore uses the proxy form (first token = rtk subcommand).
- `rtk test node --test` returns only the last few TAP summary lines when the
  suite is green; on failure it surfaces the failing cases. That is the
  intended lossy behaviour — full detail is available by re-running raw.
- Compression is **lossy**. This is the "compressed" tier of D7
  (Reference > Compressed > Full), not a substitute for full content when exact
  detail is required.

## Wiring

- `src/boundary/rtk-compress.mjs` — `rtkCompress(command, {cwd})` runs a command
  through rtk; `compressOrFallback(command, opts)` is degrade-safe: rtk if
  available, else raw command + the existing guard truncate stub. Never throws.
- `src/boundary/rtk-compress.test.mjs` — deterministic fallback tests (rtk forced
  absent via a bogus binary name) + a live rtk test that self-skips when `rtk`
  is not on PATH.
