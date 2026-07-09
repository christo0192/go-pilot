---
task: S01/T02
status: complete
duration: ~15min
files_changed:
  - panes/herdr-orchestration.md (loop reference)
  - scripts/lean-worker.sh (used as the worker)
verification: orchestrator dispatched a lean claude worker into a herdr pane and read its structured result
---

# S01/T02 — Wrap official claude as a worker pane — COMPLETE

Proved the full Go-pilot worker mechanic **without modifying ~/.claude** and fully headless.

**Loop (verified):**
1. `herdr pane run <pane> "echo PROMPT | lean-worker.sh haiku"` — dispatch lean claude worker
2. `herdr wait output <pane> --match 'total_cost_usd'` — boomerang completion sync (match a
   token that only appears in OUTPUT, never the echoed command line — see gotcha below)
3. `herdr pane read <pane> --source recent-unwrapped` → parse the `{"type":"result",...}` JSON line

**Result:** result='WORKER_OK', cost=$0.0032, tokens=24,265 — ~18× cheaper than a default
Claude Code call ($0.058) with warm cache. Confirms D16 lean-worker economics in practice.

**Gotcha recorded:** `herdr wait output --match X` matches the pane's visible text INCLUDING the
echoed command line. Never use a sentinel string that appears literally in the dispatched command
(it matches instantly, before the worker runs). Match on a result-only token (e.g. `total_cost_usd`,
`"result"`) or write to a file + signal out-of-band.

**Design confirmed:** workers = lean one-shot `claude -p` via `pane run` (deterministic, token-
accounted, cheapest, no .claude changes). The herdr claude *integration* hook (writes to
~/.claude/hooks + settings) is OPTIONAL — only for the visible-pane state sidebar; deferred so we
don't touch the builder's heavy .claude config.

**Acceptance:** orchestrator tasks the claude pane and captures its reply via socket. ✅

**Next:** T03 wrap codex (same pattern, codex CLI), T04 claude-presence, T05 worktree-per-pane.
