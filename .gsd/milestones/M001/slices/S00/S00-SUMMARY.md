# S00 — Validation Gates — SLICE COMPLETE (2026-07-09)

## Outcome: GO to build (pure-anthropic start), with T04 skipped by user (D17 policy).

## Accomplished
- **T01** repo scaffold + GSD state machine + env inventory. claude 2.1.204 + codex 0.143.0 present.
- **T02** concurrency: **10 concurrent claude sessions spawn under one Max login** (need ~4–5) → GO (D14). Residual: throughput 429s under heavy load → stagger active generators.
- **T03** baseline rig (`scripts/baseline-rig/run.py`) built + verified. Measures single vs multi tokens+cost via `claude -p --output-format json`.
- **T04** SKIPPED by user (D17): rig ready; default single-agent per class until validated.

## Key findings (shape the whole build)
- **D15/D16 — the 44k per-call overhead is mostly the builder's heavy global CLAUDE.md + user skills, then MCP schemas — NOT Claude Code itself.** Lean worker config (`--setting-sources project --strict-mcp-config --mcp-config '{}'`) cuts ~60% cost/call (45k/$0.058 → 31k/$0.022). Baked into `scripts/lean-worker.sh` + rig (workers default lean).
- Consequence: multi-pane fan-out only pays when per-subtask work >> fixed overhead; lean workers lower that break-even substantially, improving the economics vs the raw number.

## Files
scripts/baseline-rig/run.py, scripts/lean-worker.sh, docs/concurrency-report.md, metrics/quality-rubric.md, metrics/runs/trivial-smoke-*.json, .gsd/* .

## Verification
Rig ran end-to-end; concurrency confirmed by user; lean config measured. Quality axis (T04) deferred.

## Next slice: S01 — Substrate + Frontier Plane
Install Wezterm + Herdr; wrap official claude/codex as panes; claude-presence; worktree-per-pane.
Profile: pure-anthropic (claude+codex present; no LiteLLM/Pi needed yet). Some steps need interactive install/login.
