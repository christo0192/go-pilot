#!/usr/bin/env bash
# Final step of the one-click setup: the window this runs in BECOMES the herdr
# terminal. Started by setup.cmd (Windows) in a fresh console, or run directly
# on macOS/WSL. Starts the herdr server if needed, then attaches the UI.
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
cd "$HOME/Go-pilot" 2>/dev/null || cd "$(dirname "${BASH_SOURCE[0]}")/.." || true

if ! command -v herdr >/dev/null 2>&1; then
  echo "herdr is not on PATH — the install did not complete. Re-run setup." >&2
  echo "(manual install: curl -fsSL https://herdr.dev/install.sh | sh)" >&2
  read -r -p "Press Enter to close..." _
  exit 1
fi

for cli in claude codex pi; do
  if ! command -v "$cli" >/dev/null 2>&1; then
    echo "$cli is missing — setup did not pass its required acceptance gate." >&2
    read -r -p "Press Enter to close..." _
    exit 1
  fi
done

echo
echo "Go-pilot is ready. Claude Code and Codex use subscription login."
echo "In this Herdr terminal, run 'claude' and 'codex' once to sign in."
echo

# Idempotent: starting the server when one is already up is a harmless no-op.
(herdr server >/dev/null 2>&1 &)
sleep 2
exec herdr
