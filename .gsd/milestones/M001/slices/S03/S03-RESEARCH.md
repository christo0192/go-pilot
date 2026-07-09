# S03 Research — Router + Context Tiering

Verified 2026-07-09 (inline scout by main agent — substrate already understood from S00/S01).

## Inputs the router builds on
- **Dispatch mechanic (D18, VERIFIED):** lean one-shot via `herdr pane run <pane> "<cmd>"` →
  `herdr wait output <pane> --match <result-token>` → `herdr pane read <pane> --source recent-unwrapped`.
  Router's job = decide *which pane/model runs the command*, not re-implement dispatch.
- **Lean worker (D15/D16):** `scripts/lean-worker.sh <model>` and `scripts/lean-codex-worker.sh`.
  Router emits the model arg these scripts take.
- **Task classes (S00/T04, D17):** `docs/task-class-decisions.md` table is intentionally PENDING —
  each business class defaults to SINGLE-AGENT until validated. Router must therefore key on **work-type**
  (code / extract / plan / …), and treat multi-pane fan-out as opt-in per validated class, not automatic.

## Profile mapping (pure-anthropic — D5)
The mapping table is a **config value**, profile-keyed, so hybrid/open-first swap models without code change.

| Work-type (category) | Plane | pure-anthropic model | Rationale |
|---|---|---|---|
| `orchestrate`, `plan` | frontier | opus | judgment/planning (never lean) |
| `code`, `analyze`, `draft` | frontier | sonnet | default execution |
| `extract`, `classify`, `summarize` | frontier | haiku | high-volume, cheap |
| `code-review`, `lateral` | frontier | codex | cross-model check (separate ChatGPT quota) |
| `ambiguous` / unknown | — | judgment path | costed LLM call, logged separately (D8, feeds 3.9) |

## Toolchain decision
- Node v22.23 + npm present; **python3 3.14 has no pip/ensurepip**. Node is cross-platform (D1),
  needs zero third-party deps (`node:test` built-in test runner), and fits the self-bootstrapping repo (S06).
- → **Router impl = Node.js ESM, zero external deps.** (recorded as D20)

## Buildable-now vs deferred
- **Buildable now (zero external deps):** 3.1 router, 3.2 TOON, 3.3 Ref>Compressed>Full guard,
  3.8 Ponytail YAGNI fragment, 3.9 router-overhead instrumentation.
- **Deferred pilots (need tools NOT installed — rtk / CCE / context-mode):** 3.4, 3.5, 3.6.
  Defer until the tool is installed or the pilot is scheduled; they degrade-safe by design (D7).
- **3.7 agent-comms P2P mesh:** buildable (localhost TCP) but scoped to exceptions; sequence after core.
