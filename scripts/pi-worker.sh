#!/usr/bin/env bash
# One-shot workhorse worker: run a delegated subtask on an Ikey model (headless
# Pi agent) and write the result to a file. Spawned inside a herdr worker pane by
# scripts/pi-delegate.sh. Output goes to a FILE (reliable) rather than the pane
# buffer. Writes "<outfile>.done" as the completion signal.
#
# Args: <model-alias> <taskfile> <outfile>
#   model-alias: deepseek | kimi | <provider/id>
set -uo pipefail
export PATH="$HOME/.npm-global/bin:$PATH"

MODEL_ALIAS="${1:?model}"; TASKFILE="${2:?taskfile}"; OUTFILE="${3:?outfile}"
case "$MODEL_ALIAS" in
  deepseek) MODEL="ikey/test/deepseek-v4-pro" ;;
  kimi)     MODEL="ikey/test/kimi-k2.6" ;;
  *)        MODEL="$MODEL_ALIAS" ;;   # allow a full provider/id
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"                            # run from repo so .pi/ skills+extensions load

# -a trusts local resources so the worker can actually use tools; -p is headless.
pi -a -p --model "$MODEL" "$(cat "$TASKFILE")" > "$OUTFILE" 2>&1 || echo "[worker error: pi exited $?]" >> "$OUTFILE"
touch "$OUTFILE.done"
