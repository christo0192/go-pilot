---
task: T03
status: complete
duration: ~20min
executed_by: main-agent-inline
files_changed:
  - scripts/baseline-rig/run.py
  - scripts/baseline-rig/tasks/trivial-smoke.json
  - metrics/runs/trivial-smoke-single.json
  - metrics/runs/trivial-smoke-multi.json
verification: rig ran end-to-end; produced reproducible {tokens, cost} for single vs multi
---

# T03 — Baseline-paradox measurement rig — COMPLETE

Built and verified a working rig that measures single-agent vs multi-pane token + cost via
`claude -p --output-format json`.

**Deliverable:** `scripts/baseline-rig/run.py`
- `run <task.json>` runs both modes, writes `metrics/runs/<id>-{single,multi}.json`, prints comparison.
- Captures input/output/cache-creation/cache-read tokens + `total_cost_usd` per call, aggregated.
- `compare <id>` prints Δtokens / Δcost and the TOKEN-axis GO/NO-GO (≥20% cut). Quality scored
  separately via `metrics/quality-rubric.md`.
- Task fixtures = JSON (single + multi{orchestrator?, workers[], combine?}).

**Smoke test result (trivial-smoke):** single 44,849 tok/$0.057 (1 call) vs multi 135,244
tok/$0.151 (3 calls) → NO-GO. Correctly demonstrates the baseline paradox on trivial work.

**⭐ Major finding:** each Claude Code `-p` call re-pays **~44k tokens** of system-prompt
overhead (skills+MCP+CLAUDE.md). Multi-pane fan-out therefore has a high fixed cost per pane
and only pays off when per-subtask real work >> ~44k. → **Design decision D15:** worker panes
must run LEAN (skills+MCP disabled). See KNOWLEDGE.md.

**Acceptance:** rig outputs {tokens_single, tokens_multi, cost} reproducibly. ✅

**Next (T04):** run the rig on the 5 REAL task classes (ads/MIS/transcript/deck/coding) with
the builder's real data → GO/NO-GO per class in `docs/task-class-decisions.md`. Needs the
builder's data + a small measurement quota spend; run WITH the user.
