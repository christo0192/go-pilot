#!/usr/bin/env bash
# Lean Go-pilot worker (Decision D15). Strips the global ~/.claude/CLAUDE.md and all MCP
# servers so a worker pane pays ~60% less per call than a default Claude Code session
# (measured: default $0.058 / 45k tok  →  lean $0.022 / 31k tok on a trivial call).
#
# Usage:  echo "PROMPT" | scripts/lean-worker.sh <model> [extra claude flags...]
#   e.g.  echo "extract objections as JSON" | scripts/lean-worker.sh haiku
#
# Why: the 44k overhead is mostly the builder's heavy global config + MCP schemas, not
# Claude Code itself. Workers don't need any of it. Orchestrator panes stay full (they
# need judgment/context); only workers run lean.
set -euo pipefail
MODEL="${1:-haiku}"; shift || true
exec claude -p --output-format json --model "$MODEL" \
  --setting-sources project \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  "$@"
