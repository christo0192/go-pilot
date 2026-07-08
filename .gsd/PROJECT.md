# Go-pilot

Cross-platform (macOS + Windows/WSL), token-efficient multi-agent terminal orchestration rig.
A switchable orchestrator assigns work by task category to workhorse models across two planes:
- **Frontier plane** — official `claude` / `codex` binaries (subscription login).
- **Workhorse plane** — Pi → LiteLLM → open models (Kimi/GLM/DeepSeek/MiniMax), optional.

Runs in three model profiles: `pure-anthropic` (recommended start), `hybrid`, `open-first`.
Ships as a private repo that self-bootstraps on a teammate's machine.

**Source of truth:** `PLAN.md` (8 sprints, 33 steps). This milestone (M001) tracks its execution.

**Primary value drivers (from usage analysis):** kill the manual-handover tax (Mem0 persistent
memory), escape rate-limits via parallel panes, reserve Opus quota for judgment, visible/steerable
agent panes. Dollar savings are secondary and modest (frontier is flat-rate subscription).

**Non-negotiable gate:** Sprint 0 (S00) must pass — concurrent-session safety under one
subscription login + baseline-paradox go/no-go per task class — before any router/harness code.
