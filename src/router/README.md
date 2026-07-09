# Router — deterministic plane + model selection

The central control logic of the rig. Given a `task`, `route()` deterministically
decides which **plane** and **model** run it, from a profile-keyed config
(`config/router.json`). LLM judgment is the costed exception, logged separately.
The router is **pure** — same input, same output, no I/O in the decision path — and
does NOT dispatch panes; it only returns `{plane, model}`.

## Category -> tier (profile `pure-anthropic`)

| Category | Plane | Model |
|---|---|---|
| orchestrate, plan | frontier | opus |
| code, analyze, draft | frontier | sonnet |
| extract, classify, summarize | frontier | haiku |
| code-review, lateral | frontier | codex |
| (unknown / missing / `ambiguous`) | — | `__judgment__` (escalate) |

Profiles `hybrid` and `open-first` exist with empty category maps on purpose —
they prove the profile switch works without inventing models.

## Adding a category

Add a `"<category>": {"plane": "...", "model": "..."}` entry under the profile's
`categories` in `config/router.json`. No code change. An unmapped category (or the
`"__judgment__"` sentinel) automatically takes the judgment path.

## Pure vs logged

`route()` is pure and side-effect-free (bar the optional `onJudgment` hook);
`logJudgment()` in `judgment-log.mjs` is the only disk write — it appends one
self-contained, summable JSON line per escalation to
`metrics/runs/router-judgment.jsonl` (never netted into a "savings" figure).
