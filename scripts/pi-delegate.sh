#!/usr/bin/env bash
# Delegate ONE subtask to a workhorse model and print the result to stdout.
# This is the primitive the ORCHESTRATOR (Claude Code / Opus) calls to farm work
# out to Kimi/DeepSeek — the orchestrator plans, verifies and assembles (control);
# the workhorse produces the content. See CLAUDE.md + .claude/skills/orchestrate.
#
# Two worker flavors:
#   default (agentic): headless Pi agent (`pi -a -p`) in a herdr worker pane —
#     has tools (edit files, run commands). Pane auto-closes. Result captured via
#     FILE + done-marker (reliable headless; `herdr pane read` is NOT).
#   --raw (non-agentic): direct gateway HTTP via gateway-call.mjs — no tools, but
#     returns EXACT token usage (incl. reasoning tokens). Use for draft/answer work.
#
# Usage:
#   scripts/pi-delegate.sh [flags] <deepseek|kimi|provider/id> "<subtask>"
#   scripts/pi-delegate.sh [flags] <model> -          # subtask from stdin (long prompts)
# Flags:
#   --raw              non-agentic gateway call (exact token usage)
#   --repair           on MECHANICAL failure (empty/timeout/truncated/error):
#                      retry once with a stricter prompt, then once on the sibling
#                      model (deepseek<->kimi). Semantic repair stays orchestrator-side.
#   --class <label>    task class recorded in the metrics log (e.g. coding, extraction)
#   --timeout <s>      per-attempt timeout (defaults: deepseek 240s, kimi 360s, other 300s)
#   --max-tokens <n>   raw mode output cap (default 8000)
#
# Every attempt is logged as one JSON line -> scripts/baseline-rig/out/delegate-log.jsonl
# Exit: 0 ok · 2 empty · 3 timeout · 4 error · 5 truncated  (after repairs, if enabled)
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
# readlink -f: resolve symlinks so the ~/.local/bin/pi-delegate shim works from any repo
REPO="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
WORKDIR="${DELEGATE_CWD:-$PWD}"   # agentic workers run HERE (the caller's project)
LOGDIR="$REPO/scripts/baseline-rig/out"
export LOGFILE="$LOGDIR/delegate-log.jsonl"

MODE=agentic REPAIR=0 CLASS="" TIMEOUT_S="" MAX_TOKENS=8000
while [ $# -gt 0 ]; do
  case "$1" in
    --raw) MODE=raw; shift ;;
    --repair) REPAIR=1; shift ;;
    --class) CLASS="${2:?--class needs a value}"; shift 2 ;;
    --timeout) TIMEOUT_S="${2:?--timeout needs seconds}"; shift 2 ;;
    --max-tokens) MAX_TOKENS="${2:?--max-tokens needs a number}"; shift 2 ;;
    --) shift; break ;;
    -*) echo "[delegate error] unknown flag: $1" >&2; exit 4 ;;
    *) break ;;
  esac
done
ALIAS="${1:?usage: pi-delegate.sh [flags] <model> \"<subtask>\"|-}"
TASK="${2:-}"
[ "$TASK" = "-" ] || [ -n "$TASK" ] || TASK="-"
[ "$TASK" = "-" ] && TASK="$(cat)"
[ -n "$TASK" ] || { echo "[delegate error] empty subtask" >&2; exit 4; }

# Alias -> sibling for --repair reassignment. Custom provider/ids have no sibling.
case "$ALIAS" in
  deepseek) SIBLING="kimi" ;;
  kimi)     SIBLING="deepseek" ;;
  *)        SIBLING="" ;;
esac
default_timeout() { case "$1" in kimi) echo 360 ;; deepseek) echo 240 ;; *) echo 300 ;; esac; }
EXPLICIT_TIMEOUT="${TIMEOUT_S:-${DELEGATE_TIMEOUT_S:-}}"
TIMEOUT_S="${EXPLICIT_TIMEOUT:-$(default_timeout "$ALIAS")}"

DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-deleg.XXXXXX")"
trap 'rm -rf "$DIR"' EXIT
printf '%s' "$TASK" > "$DIR/task.txt"
STRICT_PREFIX="RETRY — STRICT MODE: a previous attempt returned no usable output (empty, truncated, or timed out). Produce the deliverable DIRECTLY: no preamble, no self-description, no meta-commentary. If the task asks for code or JSON, output ONLY the code/JSON.

"
printf '%s%s' "$STRICT_PREFIX" "$TASK" > "$DIR/task-strict.txt"

log_metric() { # $1 model $2 attempt $3 outcome $4 latencyMs $5 outChars $6 usageJson
  mkdir -p "$LOGDIR"
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)" M="$1" ATT="$2" OUTCOME="$3" LAT="$4" OUTCH="$5" \
  USAGE="${6:-null}" MODE="$MODE" CLASS="$CLASS" PROMPTCH="${#TASK}" REPAIR="$REPAIR" \
  node -e '
    const fs = require("fs");
    let usage = null; try { usage = JSON.parse(process.env.USAGE); } catch {}
    fs.appendFileSync(process.env.LOGFILE, JSON.stringify({
      ts: process.env.TS, mode: process.env.MODE, class: process.env.CLASS || null,
      model: process.env.M, attempt: Number(process.env.ATT), outcome: process.env.OUTCOME,
      latencyMs: Number(process.env.LAT), promptChars: Number(process.env.PROMPTCH),
      outChars: Number(process.env.OUTCH), usage, repairEnabled: process.env.REPAIR === "1",
    }) + "\n");
  ' 2>/dev/null || true
}

pane_id() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d['result']['pane']['pane_id'])" 2>/dev/null; }
root_id() { python3 -c "import sys,json;print(json.load(sys.stdin)['result']['root_pane']['pane_id'])" 2>/dev/null; }

# Globals set by each attempt: OUTCOME ok|empty|timeout|error|truncated · CONTENT file · LAT ms · USAGE json|null
run_agentic() { # $1 model-alias $2 taskfile $3 attempt-tag
  command -v herdr >/dev/null 2>&1 || { OUTCOME=error; LAT=0; USAGE=null; echo "[delegate error] herdr not found" >&2; return; }
  command -v pi >/dev/null 2>&1 || { OUTCOME=error; LAT=0; USAGE=null; echo "[delegate error] pi not found" >&2; return; }
  local OUTFILE="$DIR/out-$3.txt" WORKER ROOT CLOSE_WS="" t0 t1
  herdr status server >/dev/null 2>&1 || { herdr server >/dev/null 2>&1 & sleep 1; }
  # Split beside the orchestrator if inside herdr; else a throwaway workspace.
  WORKER="$(herdr pane split --current --direction right --no-focus 2>/dev/null | pane_id)"
  if [ -z "${WORKER:-}" ]; then
    ROOT="$(herdr workspace create --label delegate --no-focus 2>/dev/null | root_id)"
    CLOSE_WS="${ROOT%%:*}"
    WORKER="$(herdr pane split "$ROOT" --direction right --no-focus 2>/dev/null | pane_id)"
  fi
  if [ -z "${WORKER:-}" ]; then OUTCOME=error; LAT=0; USAGE=null; echo "[delegate error] could not create worker pane" >&2; return; fi
  herdr pane rename "$WORKER" "wk:$1" >/dev/null 2>&1 || true
  t0="$(node -e 'process.stdout.write(String(Date.now()))')"
  herdr pane run "$WORKER" "bash '$REPO/scripts/pi-worker.sh' '$1' '$2' '$OUTFILE' '$WORKDIR'" >/dev/null 2>&1
  local deadline=$(( $(date +%s) + TIMEOUT_S ))
  OUTCOME=ok
  while [ ! -f "$OUTFILE.done" ]; do
    [ "$(date +%s)" -ge "$deadline" ] && { OUTCOME=timeout; break; }
    sleep 2
  done
  t1="$(node -e 'process.stdout.write(String(Date.now()))')"; LAT=$(( t1 - t0 )); USAGE=null; CONTENT="$OUTFILE"
  # Pane cleanup ALWAYS (also on timeout — kills the stuck worker).
  if [ -n "$CLOSE_WS" ]; then herdr workspace close "$CLOSE_WS" >/dev/null 2>&1 || true
  else herdr pane close "$WORKER" >/dev/null 2>&1 || true; fi
  [ "$OUTCOME" = "timeout" ] && return
  if [ ! -s "$OUTFILE" ] || ! grep -q '[^[:space:]]' "$OUTFILE"; then OUTCOME=empty
  # pi-worker appends its error marker as the LAST line (possibly after partial output)
  elif tail -n 1 "$OUTFILE" | grep -q '^\[worker error'; then OUTCOME=error; fi
}

run_raw() { # $1 model-or-alias $2 taskfile $3 attempt-tag
  local RAWJSON="$DIR/raw-$3.json" rc
  node "$REPO/scripts/gateway-call.mjs" "$1" --json --timeout "$TIMEOUT_S" --max-tokens "$MAX_TOKENS" - \
    < "$2" > "$RAWJSON" 2>"$DIR/raw-$3.err"; rc=$?
  CONTENT="$DIR/out-$3.txt"
  node -e '
    const fs = require("fs");
    let j = {}; try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    fs.writeFileSync(process.argv[2], j.content || "");
    process.stdout.write(JSON.stringify({ lat: j.latencyMs ?? 0, usage: j.usage ?? null, err: j.error ?? null }));
  ' "$RAWJSON" "$CONTENT" > "$DIR/meta-$3.json" 2>/dev/null
  LAT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lat))' "$DIR/meta-$3.json" 2>/dev/null || echo 0)"
  USAGE="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).usage))' "$DIR/meta-$3.json" 2>/dev/null || echo null)"
  case "$rc" in
    0) OUTCOME=ok ;;
    2) OUTCOME=empty ;;
    5) OUTCOME=truncated ;;
    *) if grep -qi 'timeout\|aborted' "$RAWJSON" "$DIR/raw-$3.err" 2>/dev/null; then OUTCOME=timeout; else OUTCOME=error; fi ;;
  esac
}

attempt() { # $1 model $2 taskfile $3 attempt-no
  if [ "$MODE" = "raw" ]; then run_raw "$1" "$2" "$3"; else run_agentic "$1" "$2" "$3"; fi
  local outch=0; [ -f "${CONTENT:-}" ] && outch="$(wc -c < "$CONTENT" | tr -d ' ')"
  log_metric "$1" "$3" "$OUTCOME" "$LAT" "$outch" "$USAGE"
}

CONTENT=""; OUTCOME=error; LAT=0; USAGE=null
attempt "$ALIAS" "$DIR/task.txt" 1
FINAL_MODEL="$ALIAS"

if [ "$OUTCOME" != "ok" ] && [ "$REPAIR" = "1" ]; then
  echo "[delegate repair] attempt 1 on $ALIAS -> $OUTCOME; retrying strict" >&2
  attempt "$ALIAS" "$DIR/task-strict.txt" 2
  if [ "$OUTCOME" != "ok" ] && [ -n "$SIBLING" ]; then
    echo "[delegate repair] attempt 2 on $ALIAS -> $OUTCOME; reassigning to $SIBLING" >&2
    TIMEOUT_S="${EXPLICIT_TIMEOUT:-$(default_timeout "$SIBLING")}"
    attempt "$SIBLING" "$DIR/task-strict.txt" 3
    FINAL_MODEL="$SIBLING"
  fi
fi

if [ "$OUTCOME" = "ok" ]; then
  cat "$CONTENT"
  exit 0
fi
echo "[delegate failed] model=$FINAL_MODEL outcome=$OUTCOME mode=$MODE (repair=$REPAIR). Do NOT use any partial output; escalate per CLAUDE.md." >&2
case "$OUTCOME" in empty) exit 2 ;; timeout) exit 3 ;; truncated) exit 5 ;; *) exit 4 ;; esac
