# Environment Inventory

Track confirmed tool versions per machine. Update as teammates onboard.

## Builder — Windows 11 + WSL2 (Ubuntu 26.04 LTS)  ·  verified 2026-07-08

| Tool | Version | Status |
|---|---|---|
| git | 2.53.0 | ✅ |
| node | v22.23.1 | ✅ |
| npm | 10.9.8 | ✅ |
| python3 | 3.14.4 | ✅ (no pip/ensurepip in system python) |
| claude (Claude Code) | 2.1.204 | ✅ |
| codex (codex-cli) | 0.143.0 | ✅ |
| wezterm | — | ❌ not installed |
| herdr | — | ❌ not installed |
| pi | — | ❌ not installed |
| rtk | — | ❌ not installed |
| docker | — | ❌ not installed (needed for hybrid: LiteLLM + Mem0) |

**Readiness:** `pure-anthropic` profile can begin now (claude + codex present).
`hybrid`/`open-first` need docker + herdr + pi + litellm first.

## Teammate machines (Mac) — TODO

| Machine | OS | Tools verified | Notes |
|---|---|---|---|
| _tbd_ | macOS | — | fill during Sprint 6 fresh-machine verify |

## Install pointers (for Sprint 1 / Sprint 6)
- Wezterm: https://wezterm.org/  (Win installer present in Downloads; `brew install --cask wezterm` on Mac)
- Herdr: `curl -fsSL https://herdr.dev/install.sh | sh` (mac/WSL) · `brew install herdr` · Windows-beta PowerShell installer
- Pi: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- Docker: Docker Desktop (Win/Mac) or docker engine in WSL
