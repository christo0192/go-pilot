# Context-tooling decision — rtk vs CCE vs a single "context-mode" (S03 / 3.6)

**Question:** could one unified "context-mode" approach replace rtk + CCE, or do
we keep both? Decided against the REAL numbers gathered in the 3.4 / 3.5 pilots.

## What each tool actually is

| | rtk 0.43.0 | CCE (code-context-engine) 0.4.25 |
|---|---|---|
| Solves | Compresses **live command output** (git/test/lint stdout) | Retrieves **code chunks** from a semantic index of the repo |
| D7 tier it fills | **Compressed** (of transient output) | **Reference / retrieval** (of static source) |
| Input | A command's stdout/stderr, per-invocation | The whole codebase, indexed ahead of time |
| Install | Single prebuilt static binary → `~/.local/bin` (seconds, no cargo) | `uv tool install code-context-engine[local]` — tree-sitter + a local embedding model (BAAI/bge-small-en-v1.5); ~1GB of deps |
| State | Stateless | Stateful index in `~/.cce` (must be built + kept warm) |
| Measured win | **81–99.6%** char/token reduction (git log, `node --test`) | **19–55%** tokens saved per query vs serving full files |
| Cost to run | Instant, zero maintenance | Minutes to index on CPU (first run downloads the model); re-index on change |

## Verdict — KEEP BOTH; they are not substitutes

A single "context-mode" **cannot** replace both, because they operate on
different axes:

- **rtk compresses dynamic output** the moment a command runs. CCE has nothing
  to say about `node --test` stdout.
- **CCE retrieves static code** by meaning. rtk cannot answer "where is the
  router work-type mapping?".

They are complementary tiers of the *same* D7 ladder
(Reference > Compressed > Full). The **boundary guard IS the unifying
"context-mode" seam** — rtk and CCE are pluggable backends behind it:

- rtk → the **compressed** tier (`src/boundary/rtk-compress.mjs`)
- CCE → the **reference/retrieval** tier (`src/boundary/cce-retrieve.mjs`)

## Confidence / adoption

- **rtk — ADOPT (high confidence).** Cheap, instant, zero-maintenance, trivial
  user-local install, and an 81–99.6% reduction on exactly the noisy dev output
  that floods pane boundaries. Wired as the real compressed tier, degrade-safe.
- **CCE — PROVISIONAL (medium confidence).** Genuine semantic retrieval with
  19–55% per-query savings, but a heavy install, slow CPU indexing, and a
  stateful index to maintain. On a repo THIS small, the tier-2 grep file-path
  fallback is nearly as useful for a fraction of the cost — CCE earns its keep
  mainly on larger codebases with a warm index. Keep it as an OPTIONAL tier-1
  retrieval backend; the degrade chain (CCE → file-path → compressed) means we
  lose nothing when it is absent or unindexed.

## Net

Two thin, degrade-safe modules behind the existing boundary guard. rtk is the
clear win and is adopted now; CCE is retained as an optional retrieval upgrade
that pays off at larger scale. No single tool collapses the two roles.
