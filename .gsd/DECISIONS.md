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

## 2026-07-08 — Sprint 0 findings
- D14: Concurrency GATE PASSED (provisional). 10 concurrent claude sessions spawned under one Max login — >> the ~4–5 panes pure-anthropic needs. Session-count is NOT a blocker. Residual: throughput-based rate-limits under heavy simultaneous generation — monitor; fallback = stagger/queue active generators if 429s appear.

- D15: Worker panes MUST run lean (minimal system prompt; skills+MCP disabled) to amortize the ~44k-token per-call Claude Code overhead (T03 finding). Fan-out is justified only when per-subtask real work >> fixed overhead OR workers use a much cheaper per-token model. Reframes Sprint 2/3 worker config + strengthens the case for lean Pi workers.

- D16: 44k overhead breakdown MEASURED — mostly the global ~/.claude/CLAUDE.md + user skills, then MCP schemas. LEAN WORKER config = `--setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}'` cuts ~60% cost/call. Baked into scripts/lean-worker.sh and baseline rig (workers default lean). Avoid --system-prompt (cache-busts). Obsidian *app* is in Program Files; actual vault ~ C:\Graphify X\obsidian (mine in Sprint 5 for workflow skills).

- D17: T04 (baseline-paradox per-class measurement) SKIPPED by user 2026-07-09. Mitigation: rig is built+ready; policy = each task class defaults to SINGLE-AGENT until validated with scripts/baseline-rig before relying on multi-pane for it. Preserves no-negative-return principle. Residual risk accepted given D14 (concurrency GO) + D16 (lean workers ~60% cheaper) priors.

- D18: Worker dispatch model FINALIZED = lean one-shot via `herdr pane run` (claude -p / codex exec) + `herdr wait output --match <result-token>` + `pane read` parse. No agent-integration hooks required (optional polish). Match only result-only tokens in wait (never command-echo substrings).
- D19: Write-safety = worktree-per-pane (herdr worktree) as primary isolation + pane-lock.sh (flock) for shared-checkout critical sections. claude-presence deferred until a real multi-session-same-repo need appears.

## 2026-07-09 — S03 Router
- D20: Router + all Sprint-3 orchestration code = **Node.js ESM, zero external deps**, tested with the
  built-in `node --test`. Rationale: python3 3.14 on this machine has no pip/ensurepip; Node v22 + npm work
  and are cross-platform (D1) and already a hard dep; zero-dep keeps the self-bootstrapping repo (S06) light.
  Router mapping is a **profile-keyed config** (`config/router.json`) so hybrid/open-first swap models with no
  code change (D5). Router stays pure/side-effect-free except the separate judgment-cost log (feeds Step 3.9).

## 2026-07-09 — S03 (continued)
- D21: Sprint-3 external-tool pilots (Step 3.4 rtk, 3.5 CCE, 3.6 context-mode) DEFERRED — tools not
  installed and installing them is an environment/user decision. Not blockers: the T03 boundary guard
  already provides the Reference/Compressed seam these would plug real compressors into; all degrade-safe (D7).
- D22: agent-comms mesh is EXCEPTION-ONLY. The `isExceptionAllowed` guard admits only
  `{type:"query", exception:true, from, to, ask}` (a peer FACT request); default work-routing is rejected
  so chain-of-command (#4/D9) remains the only default path. Fact-not-full-content ties it to the #1 invariant.

## 2026-07-09 — S04 Memory
- D23: S04 memory seams (store, gate, mem0-adapter, promotion, recall) built + tested against an in-memory
  MOCK Mem0 adapter under the pure-code scope chosen by the user. The mock and the future real Docker Mem0
  client implement one identical `{ add(memory), search(query, topK) }` contract — the only coupling point,
  so the real client is a drop-in (Step 4.3 deferred, not blocking). Two-tier pipeline: store(Tier-1) → gate →
  promotion(keepers only) → mem0-adapter(Tier-2) → recall(session-start). Directly targets #1 friction (407 handovers).
