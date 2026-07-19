#!/usr/bin/env bash
# Non-interactive workhorse dispatch for the governed coordinator
# (src/dispatch/dispatch.mjs -> this script). Runs ONE headless Pi agent turn on
# the Ikey workhorse gateway and prints the result to stdout.
#
# Called as:  pi-gopilot.sh --model <gateway-id> --print "<prompt>"
#   <gateway-id> is the pinned model version, e.g. test/deepseek-v4-pro. Bare
#   gateway ids (test/*) are referenced through the registered "ikey" Pi provider
#   (see deploy/pi-models.ikey.json; its key is read from deploy/.env at runtime),
#   which is why the working delegation path (pi-worker.sh) uses the ikey/ prefix.
#   The prior version forced `--provider openai`, which 400s on gateway ids — the
#   coordinator's live workhorse path never worked until this fix.
set -euo pipefail
export PATH="$HOME/.npm-global/bin:$PATH"
REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$REPO"                       # .pi/skills + .pi/extensions discover from cwd

MODEL=""; PROMPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="${2:?--model needs a value}"; shift 2 ;;
    --print) PROMPT="${2:?--print needs a prompt}"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$MODEL" ] || { echo "pi-gopilot: --model <gateway-id> required" >&2; exit 2; }
[ -n "$PROMPT" ] || { echo "pi-gopilot: --print <prompt> required" >&2; exit 2; }

# Bare Ikey gateway ids resolve through the registered "ikey" provider.
case "$MODEL" in
  test/*) MODEL="ikey/$MODEL" ;;
esac

if ! command -v pi >/dev/null 2>&1; then
  echo "pi not found. Install: npm install -g --ignore-scripts @earendil-works/pi-coding-agent" >&2
  exit 1
fi

# -a trusts project-local resources (.pi/skills + .pi/extensions); -p is headless.
exec pi -a -p --model "$MODEL" "$PROMPT"
