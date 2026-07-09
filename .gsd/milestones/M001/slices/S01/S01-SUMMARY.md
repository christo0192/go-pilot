# S01 — Substrate + Frontier Plane — SLICE COMPLETE (2026-07-09)

## Outcome: the entire frontier-plane substrate works, headless, no external installs beyond Herdr.

## Tasks
- **T01** ✅ Herdr 0.7.3 installed; headless server + socket API; orchestration loop
  (`pane run → wait output → pane read`) PROVEN. Ref: panes/herdr-orchestration.md.
- **T02** ✅ Lean `claude` worker in a pane: result='WORKER_OK', $0.0032, ~18× cheaper than default.
- **T03** ✅ Lean `codex` (GPT) worker in a pane: result='CODEX_WORKER_OK'. Codex overhead ~12.5k
  tok (much lighter than Claude's ~44k); logged in via ChatGPT; separate quota. Wrapper:
  scripts/lean-codex-worker.sh. Schema = JSONL events ending in `turn.completed`.
- **T04** ✅ Write-safety: worktree isolation (T05) is primary; scripts/pane-lock.sh (flock advisory
  lock) serializes shared-checkout writers — verified 3 concurrent writers, no interleave.
  Full claude-presence (registry + broadcast inbox) deferred until multi-session same-repo need.
- **T05** ✅ `herdr worktree create --branch --base --path` makes a per-pane isolated git worktree
  (verified created + git-visible + removed cleanly). Planner (main worktree) owns merge-back.

## Key facts learned
- Herdr socket API is fully scriptable headlessly (works in cron/CI, not just interactive TTY).
- `herdr wait output --match` is the built-in boomerang/completion primitive — BUT it also matches
  the echoed command line; match a result-only token (`total_cost_usd`, `turn.completed`), never a
  sentinel that appears in the dispatched command.
- Codex is inherently leaner than Claude Code (12.5k vs 44k system-prompt overhead).
- No `~/.claude` modification needed for the worker model (integration hooks are optional polish).

## Files
scripts/lean-worker.sh, scripts/lean-codex-worker.sh, scripts/pane-lock.sh, panes/herdr-orchestration.md.

## Next: S02 SKIPPED in pure-anthropic profile → S03 Router + Context Tiering.
Router maps task-category → {plane, model}. In pure-anthropic: claude(opus/sonnet/haiku) + codex(GPT).
S03 is design-heavy (deterministic router, Reference>Compressed>Full, TOON, rtk, CCE) — good point for a fresh session.
