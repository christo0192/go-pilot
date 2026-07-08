# Go-pilot

A cross-platform, token-efficient **multi-agent terminal orchestration rig**. A switchable
orchestrator assigns work by task category to workhorse models across two planes, with
persistent cross-session memory so you never hand-write a context handover again.

> **Status:** Sprint 0 (validation gates) in progress. Not yet usable end-to-end.
> Build proceeds sprint-by-sprint per [`PLAN.md`](PLAN.md) (the source of truth).

## What it is

- **Terminal substrate:** Wezterm + Herdr (visible, steerable agent panes; cross-platform).
- **Frontier plane:** official `claude` / `codex` binaries via your subscription login.
- **Workhorse plane (optional):** Pi → LiteLLM → open models (Kimi/GLM/DeepSeek/MiniMax).
- **Memory:** Mem0 (persistent) + boomerang/shared-store (working).
- **Context tiering:** Reference > Compressed > Full; TOON specs; rtk/CCE compression.

## Model profiles (pick per project)

| Profile | Orchestrator | Workers | Needs |
|---|---|---|---|
| **`pure-anthropic`** *(recommended start)* | Opus (claude) | Sonnet/Haiku (claude) + GPT (codex) | Claude Max + ChatGPT subs only |
| `hybrid` | Claude/Opus | open models via Pi/LiteLLM | + Docker, API keys |
| `open-first` | GLM/Kimi | open models | API keys (most portable) |

## Quick start (once Sprint 0 passes)

```bash
cp .env.example .env      # set GOPILOT_PROFILE; add keys only for hybrid/open-first
./scripts/install.sh      # (Sprint 6) idempotent bootstrap — mac/WSL
# Windows: ./scripts/install.ps1
```

## Repo layout

```
PLAN.md            # source-of-truth build plan (8 sprints)
.gsd/              # GSD autonomous-execution state (M001 tracks PLAN.md)
research docs/     # BRD, model strategy, sources & decisions
config/            # litellm.yaml, tool-profiles.yaml, router rules
scripts/           # install + spike + rig scripts
panes/             # herdr pane/workspace layout
metrics/           # quality rubric + run metrics
docs/              # environment inventory, spike reports, decisions
src/               # harness code (Pi extensions, router)
```

## Current toolchain (this machine)

See [`docs/environments.md`](docs/environments.md). Installed: git, node, python3, **claude, codex**.
Pending: wezterm, herdr, pi, rtk, docker.
