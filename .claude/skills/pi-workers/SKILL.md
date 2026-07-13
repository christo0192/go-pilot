---
name: pi-workers
description: How the Kimi/DeepSeek workhorse workers actually run — Pi agentic vs raw gateway flavors, model IDs, caps, timeouts, metrics log, gateway facts and known model quirks. Use when delegating work, debugging a failed delegation, or choosing between agentic and raw workers.
---

# Pi Workers

## Models (Ikey gateway — user's own hosted LiteLLM, https://ikey-gateway.fly.dev/v1)

| Alias | Gateway ID | Pi ID | Use for | Default timeout |
|---|---|---|---|---|
| `deepseek` | `test/deepseek-v4-pro` | `ikey/test/deepseek-v4-pro` | code, math, reasoning, repo edits, extraction, summaries — DEFAULT | 240s |
| `kimi` | `test/kimi-k2.6` | `ikey/test/kimi-k2.6` | creative, lateral, long-doc synthesis ONLY | 360s |

Key: `WORKHORSE_GATEWAY_KEY` in gitignored `deploy/.env` (scripts load it themselves — never print it).

## Two worker flavors

1. **Agentic** (default of `pi-delegate.sh`): `pi -a -p --model ikey/...` inside a herdr pane, running in the CALLER's cwd. Has tools — can edit files and run commands. Exact token usage is recovered post-run from Pi's session logs (`scripts/pi-usage.mjs`) and logged to the ledger. Note the agentic scaffold costs ~3-4k input tokens per run — prefer `--raw` when no tools are needed. Use `--sandbox` for repo edits (worker gets a throwaway git worktree; review diff, then apply).
2. **Raw** (`pi-delegate.sh --raw`, or directly `node scripts/gateway-call.mjs <alias> --json "<prompt>"`): direct HTTP chat completion. No tools, but returns exact `usage` including reasoning tokens, plus `finishReason` (`length` = truncated). Prefer for anything that's pure text/JSON production — better accounting, less overhead.

## Governance (automatic in pi-delegate)

- **Breaker**: `scripts/breaker-check.mjs <model>` — 3 consecutive failures in 10 min opens the model for 5 min; delegate auto-reroutes to the sibling or exits 6. `--force-model` bypasses.
- **Budget**: `scripts/spend-guard.mjs` — settled cumulative gateway spend vs `GOPILOT_SPEND_CAP_USD` (default 7); delegate exits 7 when over. `--allow-over-budget` bypasses. Fail-open on gateway/infra errors, fail-closed on real over-budget.
- **Journal**: `--journal <dir>` appends per-subtask outcomes to `<dir>/subtasks.jsonl` for resumable orchestrations.

`scripts/pi-worker.sh <alias> <taskfile> <outfile>` is the agentic one-shot the pane runs (writes `<outfile>` + `<outfile>.done`).

## Reliability facts (verified — don't re-test)

- **Both are reasoning models**; reasoning tokens are billed. Never set small `max_tokens` (Kimi returned EMPTY at 20) — keep ≥ a few thousand.
- **Kimi k2.6 reasoning cannot be disabled** — 7 API params probed, gateway drops them all. Latency varies 3–140s. Mitigate: prefer deepseek; cap output; `--repair` handles empties.
- **DeepSeek self-IDs as "Claude 3.5 Sonnet"** — ignore self-ID, label by dispatched model.
- **Gateway spend settles ASYNC** — immediate before/after spend reads show no delta; read settled cumulative `/key/info` spend at checkpoints only.
- Empty / timeout / truncated outputs are FAILURES; `--repair` retries strict then swaps sibling; exit codes: 0 ok, 2 empty, 3 timeout, 4 error, 5 truncated.

## Metrics

Every delegate attempt appends a JSON line to `scripts/baseline-rig/out/delegate-log.jsonl`:
`{ts, mode, class, model, attempt, outcome, latencyMs, promptChars, outChars, usage, repairEnabled}`.
Use it to report per-session delegation stats (tokens where available, failures, repair rate).
