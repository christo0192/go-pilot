#!/usr/bin/env bash
# Launch Pi's agentic loop on the Ikey test gateway models — the exact workhorses
# the S11 live benchmark used:  test/kimi-k2.6  and  test/deepseek-v4-pro.
#
# Pi reaches them via the custom provider "ikey" registered in
# ~/.pi/agent/models.json (reference: deploy/pi-models.ikey.json). That provider
# is OpenAI-compatible AND tool-calling-capable (verified), so the agentic loop
# works with no local LiteLLM/docker. The provider reads WORKHORSE_GATEWAY_KEY
# from deploy/.env at runtime — no hardcoded secret.
#
# Usage:
#   ./scripts/pi-ikey.sh                                       # Kimi K2.6 (default)
#   GOPILOT_MODEL=ikey/test/deepseek-v4-pro ./scripts/pi-ikey.sh   # DeepSeek V4 Pro
#   ./scripts/pi-ikey.sh "your first task"                     # extra args pass to pi
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"                        # .pi/skills + .pi/extensions discover from cwd

if ! command -v pi >/dev/null 2>&1; then
  echo "pi not found. Install: npm install -g --ignore-scripts @earendil-works/pi-coding-agent" >&2
  exit 1
fi

# Ensure the "ikey" custom provider is registered. Only writes when NO models.json
# exists (never clobbers an existing one); warns if present but missing "ikey".
PICFG="$HOME/.pi/agent/models.json"
if [ ! -f "$PICFG" ]; then
  mkdir -p "$HOME/.pi/agent"
  # Template -> real config: substitute this machine's repo path (portable installs).
  sed "s|__GOPILOT_REPO__|$REPO|g" "$REPO/deploy/pi-models.ikey.json" > "$PICFG"
  echo "Installed Ikey provider -> $PICFG" >&2
elif ! grep -q '"ikey"' "$PICFG"; then
  echo "NOTE: $PICFG exists without an \"ikey\" provider — merge deploy/pi-models.ikey.json into it." >&2
fi

MODEL="${GOPILOT_MODEL:-ikey/test/kimi-k2.6}"
echo "Pi → Ikey gateway · model: $MODEL" >&2

# -a trusts project-local .pi/ resources. provider/id selects the gateway model.
exec pi -a --model "$MODEL" "$@"
