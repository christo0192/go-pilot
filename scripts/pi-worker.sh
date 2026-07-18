#!/usr/bin/env bash
# One-shot workhorse worker: run a delegated subtask on an Ikey model (headless
# Pi agent) and write the result to a file. Spawned inside a herdr worker pane by
# scripts/pi-delegate.sh. Output goes to a FILE (reliable) rather than the pane
# buffer. Writes "<outfile>.done" as the completion signal.
#
# Args: <model-alias> <taskfile> <outfile> [workdir]
#   model-alias: deepseek | kimi | kimi25 | kimi26 | <provider/id>
#   workdir: where the agent runs (the CALLER's project, so repo-edit subtasks
#            touch the right repo). Defaults to the Go-pilot repo.
set -uo pipefail
export PATH="$HOME/.npm-global/bin:$PATH"

MODEL_ALIAS="${1:?model}"; TASKFILE="${2:?taskfile}"; OUTFILE="${3:?outfile}"; WORKDIR="${4:-}"
case "$MODEL_ALIAS" in
  deepseek) MODEL="ikey/test/deepseek-v4-pro" ;;
  kimi|kimi25) MODEL="ikey/test/kimi-k2.5" ;;
  kimi26)   MODEL="ikey/test/kimi-k2.6" ;;
  *)        MODEL="$MODEL_ALIAS" ;;   # allow a full provider/id
esac

REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "${WORKDIR:-$REPO}"                # caller's project (repo edits land there); Go-pilot if unset

T0="$(node -e 'process.stdout.write(String(Date.now()))')"
# -a trusts local resources so the worker can actually use tools; -p is headless.
pi -a -p --model "$MODEL" "$(cat "$TASKFILE")" > "$OUTFILE" 2>&1 || echo "[worker error: pi exited $?]" >> "$OUTFILE"
# Recover exact token usage from Pi's session log (pi -p prints none). Snippet
# of the task text disambiguates our session from concurrent workers.
SNIPPET="$(tr -c 'a-zA-Z0-9 ' ' ' < "$TASKFILE" | tr -s ' ' | head -c 60)"
node "$REPO/scripts/pi-usage.mjs" "$T0" "$SNIPPET" > "$OUTFILE.usage" 2>/dev/null || rm -f "$OUTFILE.usage"
touch "$OUTFILE.done"
