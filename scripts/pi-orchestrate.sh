#!/usr/bin/env bash
# Launch an Opus ORCHESTRATOR in Pi that delegates subtasks to Kimi/DeepSeek
# workhorses via herdr. Opus plans/routes/verifies/assembles (control); the
# workhorses produce content (scripts/pi-delegate.sh). The .pi/skills/orchestrate
# skill loads from the repo cwd and tells Opus how to delegate.
#
# Requires: Claude Pro/Max login in Pi (`pi` then `/login` → Claude) for the
# orchestrator model, the Ikey provider registered (scripts/pi-ikey.sh installs
# it) for the workers, and herdr for the worker panes.
#
# Usage:
#   ./scripts/pi-orchestrate.sh                     # Opus orchestrator (default)
#   GOPILOT_ORCH_MODEL=sonnet ./scripts/pi-orchestrate.sh
#   ./scripts/pi-orchestrate.sh "Build X: <multi-step task>"   # seed a task
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"                        # loads .pi/skills (incl. orchestrate) + extensions

command -v pi >/dev/null 2>&1 || { echo "pi not found. npm i -g --ignore-scripts @earendil-works/pi-coding-agent" >&2; exit 1; }
if ! command -v herdr >/dev/null 2>&1; then
  echo "WARNING: herdr not found — delegation (scripts/pi-delegate.sh) needs it." >&2
fi

# Ensure the workhorse provider is registered for the workers.
[ -f "$HOME/.pi/agent/models.json" ] || { mkdir -p "$HOME/.pi/agent"; cp "$REPO/deploy/pi-models.ikey.json" "$HOME/.pi/agent/models.json"; echo "Installed Ikey provider config." >&2; }

# Ensure the headless herdr server is up so worker panes can spawn.
if command -v herdr >/dev/null 2>&1; then
  herdr status server >/dev/null 2>&1 || { herdr server >/dev/null 2>&1 & sleep 1; echo "Started herdr server." >&2; }
fi

MODEL="${GOPILOT_ORCH_MODEL:-opus}"
echo "Orchestrator: Pi + '$MODEL'  →  delegates to Kimi/DeepSeek via scripts/pi-delegate.sh" >&2
echo "In the session: give a multi-step task and run the 'orchestrate' skill (/skill orchestrate)." >&2

exec pi -a --model "$MODEL" "$@"
