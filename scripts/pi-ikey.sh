#!/usr/bin/env bash
# Launch the Pi agentic terminal pointed DIRECTLY at the Ikey test gateway —
# the exact workhorse models the S11 live benchmark used:
#   test/kimi-k2.6  and  test/deepseek-v4-pro
#
# The Ikey gateway (https://ikey-gateway.fly.dev/v1) is OpenAI-compatible AND
# supports tool-calling (verified), so Pi's interactive agentic loop works
# against it with no local LiteLLM/docker. Skills + extensions in .pi/ load from
# the repo cwd (tool-call-repair helps flaky open-model tool calls).
#
# Usage:
#   ./scripts/pi-ikey.sh                              # Kimi K2.6 (default)
#   GOPILOT_MODEL=test/deepseek-v4-pro ./scripts/pi-ikey.sh   # DeepSeek V4 Pro
#   ./scripts/pi-ikey.sh "your first task here"       # extra args pass to pi
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"                        # .pi/skills + .pi/extensions discover from cwd

if ! command -v pi >/dev/null 2>&1; then
  echo "pi not found. Install: npm install -g --ignore-scripts @earendil-works/pi-coding-agent" >&2
  exit 1
fi

# Read the gateway key from the gitignored deployment env.
if [ ! -f deploy/.env ]; then
  echo "deploy/.env not found — need WORKHORSE_GATEWAY_KEY there." >&2
  exit 1
fi
GATEWAY_KEY="$(grep -E '^WORKHORSE_GATEWAY_KEY=' deploy/.env | cut -d= -f2- || true)"
if [ -z "${GATEWAY_KEY:-}" ]; then
  echo "WORKHORSE_GATEWAY_KEY is empty in deploy/.env." >&2
  exit 1
fi

# Point Pi's OpenAI-protocol client at the Ikey gateway.
export OPENAI_BASE_URL="https://ikey-gateway.fly.dev/v1"
export OPENAI_API_KEY="$GATEWAY_KEY"

MODEL="${GOPILOT_MODEL:-test/kimi-k2.6}"
echo "Pi → Ikey gateway · model: $MODEL" >&2

# -a trusts project-local .pi/ resources. --model selects the gateway model id.
exec pi -a --provider openai --model "$MODEL" "$@"
