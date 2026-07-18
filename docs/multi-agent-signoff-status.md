# Multi-agent efficiency sign-off — status (D17 / D39)

`src/metrics/signoff.mjs` is the per-task-class go-live gate for multi-pane
execution (D17): a class is signed off for multi-agent **only if** multi-agent is
≥20% cheaper in tokens **and** drops quality ≤5% vs the single-agent baseline;
otherwise it reverts to single-agent. A class with no live data reverts (safe
default — reverting to the proven baseline has no negative return).

## Active certification (evaluated 2026-07-18)

| class | reduction% | drop% | verdict |
| --- | --- | --- | --- |
| creative | — | — | revert-to-single |
| deterministic | — | — | revert-to-single |
| evidence-grounded | — | — | revert-to-single |
| long-context | — | — | revert-to-single |
| subjective | — | — | revert-to-single |

All five classes **revert to single-agent**. The framework runs single-agent.

## Why no efficiency campaign is run (and the sign-off can only revert)

The gate certifies a **token-reduction** claim. This framework's multi-pane modes
do not make that claim:

- **`candidate-race`** runs the *same* task on N parallel panes to buy reliability
  — it costs ~N× the tokens. It is explicitly **cost-opt-in** (D37), not
  efficiency-gated, and would always fail the ≥20%-reduction bar.
- **`multi-agent`** (decomposition) adds coordination/overhead; for the
  single-shot task classes here, total tokens across sub-agents are ≥ single-agent.

So a paired single-vs-multi campaign would confirm "revert" for every class — the
verdict already active. It is also currently blocked by a live-path gap: the
coordinator's Pi-session token-usage recovery is degraded (returns no usage on
live workhorse runs), so reliable paired token counts can't be harvested yet.

**Conclusion:** the sign-off is code-complete, tested, and correctly reverts to
the single-agent baseline. Certifying a multi-agent class would require a task set
where multi-agent genuinely reduces *total* tokens — not this framework's
reliability-oriented multi-pane design — so no efficiency campaign is warranted.
Re-open if a decomposition mode with a real token-reduction claim is added.
