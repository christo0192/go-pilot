#!/usr/bin/env bash
# Delegate ONE subtask to a workhorse model, running it in a herdr worker pane,
# and print the worker's result to stdout. This is the primitive an orchestrator
# (Opus in a Pi pane) calls to farm work out to Kimi/DeepSeek — Opus plans and
# assembles (control), the workhorse produces the content.
#
# Uses herdr for the VISIBLE worker pane (official pattern:
# https://github.com/ogulcancelik/herdr) but captures the result via a FILE +
# done-marker (reliable headless, unlike pane-buffer reads).
#
# Usage:
#   scripts/pi-delegate.sh <deepseek|kimi|provider/id> "<subtask>"
#   scripts/pi-delegate.sh deepseek "Implement merge_intervals in Python; return only the code."
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODEL="${1:?usage: pi-delegate.sh <model> \"<subtask>\"}"
TASK="${2:?usage: pi-delegate.sh <model> \"<subtask>\"}"
TIMEOUT_S="${DELEGATE_TIMEOUT_S:-300}"

command -v herdr >/dev/null 2>&1 || { echo "[delegate error] herdr not found" >&2; exit 1; }
command -v pi   >/dev/null 2>&1 || { echo "[delegate error] pi not found" >&2; exit 1; }

DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-deleg.XXXXXX")"
TASKFILE="$DIR/task.txt"; OUTFILE="$DIR/out.txt"
printf '%s' "$TASK" > "$TASKFILE"

pane_id() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d['result']['pane']['pane_id'])" 2>/dev/null; }
root_id() { python3 -c "import sys,json;print(json.load(sys.stdin)['result']['root_pane']['pane_id'])" 2>/dev/null; }

# Ensure the headless server is up.
herdr status server >/dev/null 2>&1 || { herdr server >/dev/null 2>&1 & sleep 1; }

# Get a worker pane: split beside the orchestrator if we're inside herdr; else a
# fresh workspace (standalone / testing).
CLOSE_WS=""
WORKER="$(herdr pane split --current --direction right --no-focus 2>/dev/null | pane_id)"
if [ -z "${WORKER:-}" ]; then
  ROOT="$(herdr workspace create --label delegate --no-focus 2>/dev/null | root_id)"
  CLOSE_WS="${ROOT%%:*}"
  WORKER="$(herdr pane split "$ROOT" --direction right --no-focus 2>/dev/null | pane_id)"
fi
[ -n "${WORKER:-}" ] || { echo "[delegate error] could not create worker pane" >&2; rm -rf "$DIR"; exit 1; }

herdr pane rename "$WORKER" "wk:$MODEL" >/dev/null 2>&1 || true
# Run the one-shot worker (writes result -> OUTFILE, then OUTFILE.done).
herdr pane run "$WORKER" "bash '$REPO/scripts/pi-worker.sh' '$MODEL' '$TASKFILE' '$OUTFILE'" >/dev/null 2>&1

# Wait for completion via the done-marker file (reliable), bounded by timeout.
deadline=$(( $(date +%s) + TIMEOUT_S ))
while [ ! -f "$OUTFILE.done" ]; do
  [ "$(date +%s)" -ge "$deadline" ] && { echo "[delegate timeout after ${TIMEOUT_S}s]"; break; }
  sleep 2
done

[ -f "$OUTFILE" ] && cat "$OUTFILE"

# Cleanup: close the worker pane (or the workspace we created).
if [ -n "$CLOSE_WS" ]; then herdr workspace close "$CLOSE_WS" >/dev/null 2>&1 || true
else herdr pane close "$WORKER" >/dev/null 2>&1 || true; fi
rm -rf "$DIR"
