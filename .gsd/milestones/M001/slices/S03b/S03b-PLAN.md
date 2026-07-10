# S03b: Context-Tooling Pilots (deferred S03 Steps 3.4/3.5/3.6) — DONE 2026-07-10

Tools identified (web) + installed user-local (no sudo). Both degrade-safe behind the boundary guard (D7).

## Outcome
- [x] **3.4 rtk** — ADOPTED. rtk 0.43.0 (prebuilt musl binary → ~/.local/bin). Real compression on this repo:
  git log 98.6%, node --test 99.6%, git log --stat 81.2% (chars/4 proxy). `src/boundary/rtk-compress.mjs`
  (`rtkCompress`, `compressOrFallback` → rtk else raw+truncate stub, never throws). metrics/rtk-vs-raw.md.
- [x] **3.5 CCE** — PROVISIONAL/retained. cce 0.4.25 (`uv tool install code-context-engine[local]`, local
  bge-small embeddings, no Ollama). Retrieval proven (router.mjs #1 for a router query). `src/boundary/
  cce-retrieve.mjs` fallback chain CCE→file-path→compressed, never throws.
- [x] **3.6 verdict** — KEEP BOTH (docs/context-tooling-decision.md): rtk compresses live command output
  (Compressed tier), CCE retrieves static code (Reference tier) — orthogonal axes of the D7 ladder; the
  boundary guard is the unifying seam, both are pluggable backends. rtk=adopt (cheap/instant), CCE=provisional
  (heavy index; grep file-path fallback nearly as good at this repo size, pays off at scale).

## Verify
- node --test 145/145 (135 + 10 new). Live rtk+cce tests RAN here; self-skip when the tool is absent (suite
  stays green anywhere). Zero npm deps; package.json untouched.
