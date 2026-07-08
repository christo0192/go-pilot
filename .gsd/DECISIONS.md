# Architectural Decisions (append-only)

## 2026-07-08 — Foundational (from brainstorm + research)
- D1: Terminal = Wezterm + Herdr (cross-platform). cmux rejected (macOS-only; builder on Windows/WSL).
- D2: Harness = Pi for open-model workers only. Official claude/codex binaries wrapped directly, NEVER via Pi/3rd-party OAuth (billing-as-extra-usage risk).
- D3: Access layer = LiteLLM self-hosted (Docker, local ≈ $0). Open models only; frontier uses native login.
- D4: Two planes joined by Herdr (frontier subscription / workhorse API). Orchestrator switchable per project.
- D5: Three model profiles — pure-anthropic (start), hybrid, open-first — as a config value; shared router/memory/tiering across all.
- D6: Memory = Tier-1 boomerang + shared store (ephemeral) + Tier-2 Mem0 (persistent), joined by a promotion filter. Fixes #1 friction (407 handovers). Letta/LLMLingua-2 deferred.
- D7: Context = Reference > Compressed > Full across pane boundaries; TOON for specs; rtk default output compression; CCE pilot-only with CCE→file→Compressed fallback; context-mode consolidation pilot.
- D8: Deterministic rule-based routing default; LLM judgment is the costed exception. Router overhead tracked as its own line item.
- D9: Validation gate BEFORE compression; git worktree per executing pane, merge-back owned by planner; chain-of-command escalation default (P2P exception only via agent-comms).
- D10: Numeric acceptance — ≥20% token reduction vs single-agent, ≤5% quality tolerance, tracked retry rates, router overhead separate.
- D11: Sprint 0 gates the project — concurrent-session safety + baseline-paradox pre-check before any router/harness code.

## 2026-07-08 — Execution
- D12: GSD milestone M001 tracks PLAN.md; PLAN.md remains the step-detail source of truth.
- D13: Sprint 0 spikes (T02–T04) are interactive/machine-specific — executed WITH the user (subscription login), not via autonomous subagent. Step 0.1 executed inline by main agent.
