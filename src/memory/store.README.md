# Tier-1 working memory — shared task store + boomerang

- **Role.** Tier-1 (fast, local) working memory that coordinates workers over a
  file-backed task store rooted at a directory (`createStore(rootDir)`).
- **Atomic claim (O_EXCL).** `claim(id, worker)` creates a claim marker with
  `openSync(path, "wx")`. Exactly one caller can create it; losers get EEXIST
  and return `null` without throwing. The OS enforces this, so the guarantee
  holds across processes, not just concurrent promises.
- **Cascade / ready.** Each task has `deps = [ids]`. `ready()` (aliased
  `cascade()`) lists pending tasks whose every dep is `done`. `complete(id,
  result)` is the cascade trigger — finishing a dep unblocks its dependents.
- **Inspection.** `add` / `get` / `list` persist one JSON file per task under
  `<root>/tasks/`; claim markers live under `<root>/claims/`.
- **Boomerang = collapse-before-report.** `boomerang(exchange, summarizeFn?)`
  shrinks a worker's exchange to a short summary (keeps DECISION/RESULT lines +
  the final line, capped to N chars). Deterministic heuristic by default, no LLM
  — a real summarizer is injectable via `summarizeFn` later.
