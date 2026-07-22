#!/usr/bin/env bash
# Start the managed interactive Pi, continuing its most recent Go-pilot
# conversation after a genuine Herdr/WSL restart. While the headless Herdr
# server remains alive this wrapper is not re-run; the original Pi process is
# still attached to its PTY.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION_DIR="${GOPILOT_PI_SESSION_DIR:-$HOME/.local/share/gopilot/pi-sessions}"
mkdir -p "$SESSION_DIR"

shopt -s nullglob
sessions=("$SESSION_DIR"/*.jsonl)
shopt -u nullglob

if (( ${#sessions[@]} > 0 )); then
  exec "$ROOT/scripts/pi-ikey.sh" --session-dir "$SESSION_DIR" --continue
fi
exec "$ROOT/scripts/pi-ikey.sh" --session-dir "$SESSION_DIR" --name Go-pilot
