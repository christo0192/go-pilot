#!/usr/bin/env bash
# Final step of the one-click setup: the window this runs in becomes the Herdr
# client. The named server is started headlessly by gopilot-session.sh and stays
# alive when this visible terminal closes, so the next launch resumes it.
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

exec bash "$PWD/scripts/gopilot-session.sh" attach
