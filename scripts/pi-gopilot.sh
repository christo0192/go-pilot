#!/usr/bin/env bash
# Launch the Pi terminal inside the Go-pilot repo with our skills + extensions
# loaded (.pi/skills/, .pi/extensions/). Uses OpenAI as the test provider until
# the LiteLLM workhorse gateway has a provider key; once OPENROUTER_API_KEY is set
# you'll instead point Pi at LiteLLM (http://localhost:4000).
#
# Usage:  bash scripts/pi-gopilot.sh          # from anywhere
#         ./scripts/pi-gopilot.sh
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"                       # .pi/skills + .pi/extensions discover from cwd

if ! command -v pi >/dev/null 2>&1; then
  echo "pi not found. Install: npm install -g --ignore-scripts @earendil-works/pi-coding-agent" >&2
  exit 1
fi

# Load the gitignored deployment environment without exporting arbitrary shell
# syntax. The workhorse uses LiteLLM's OpenAI-compatible endpoint when present.
if [ -f deploy/.env ]; then
  openai_key="$(grep -E '^OPENAI_API_KEY=' deploy/.env | cut -d= -f2- || true)"
  litellm_key="$(grep -E '^LITELLM_MASTER_KEY=' deploy/.env | cut -d= -f2- || true)"
  litellm_url="$(grep -E '^LITELLM_BASE_URL=' deploy/.env | cut -d= -f2- || true)"
  [ -n "${openai_key:-}" ] && export OPENAI_API_KEY="$openai_key"
  if [ -n "${litellm_url:-}" ]; then
    export OPENAI_BASE_URL="$litellm_url"
    export OPENAI_API_KEY="${litellm_key:-${OPENAI_API_KEY:-}}"
  fi
fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "No OPENAI_API_KEY (set it in deploy/.env). Starting Pi anyway — set a --provider/--api-key yourself." >&2
fi

# -a trusts project-local resources (.pi/skills + .pi/extensions). The caller's
# trailing --model wins, allowing the governed router to select the alias.
exec pi -a --provider openai --model "${GOPILOT_MODEL:-gpt-4o-mini}" "$@"
