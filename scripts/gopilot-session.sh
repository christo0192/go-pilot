#!/usr/bin/env bash
# Persistent Go-pilot lifecycle.
#
# The Herdr server is always a named, detached/headless process. The visible
# Herdr TUI is only a client, so closing Windows Terminal does not kill panes or
# Pi. Herdr persists named-session layout on disk; after a server/WSL restart we
# restart Pi with its dedicated --continue store when the managed pane is idle.
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${GOPILOT_HERDR_SESSION:-gopilot}"
WORKSPACE_LABEL="${GOPILOT_WORKSPACE_LABEL:-Go-pilot}"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/gopilot"
SERVER_LOG="$STATE_HOME/herdr-server.log"

log() { printf '[gopilot] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_runtime() {
  command -v node >/dev/null 2>&1 || die "node is missing; re-run Go-pilot setup"
  command -v herdr >/dev/null 2>&1 || die "herdr is missing; re-run Go-pilot setup"
}

session_running() {
  herdr session list --json 2>/dev/null | SESSION_NAME="$SESSION" node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const found = JSON.parse(s).sessions?.find(x => x.name === process.env.SESSION_NAME);
        process.exit(found?.running ? 0 : 1);
      } catch { process.exit(1); }
    });
  '
}

start_server() {
  session_running && return 0
  mkdir -p "$STATE_HOME"
  log "starting headless Herdr session '$SESSION'"
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid herdr --session "$SESSION" server >>"$SERVER_LOG" 2>&1 </dev/null &
  else
    nohup herdr --session "$SESSION" server >>"$SERVER_LOG" 2>&1 </dev/null &
  fi

  local _
  for _ in $(seq 1 50); do
    session_running && return 0
    sleep 0.1
  done
  tail -n 30 "$SERVER_LOG" >&2 2>/dev/null || true
  die "headless Herdr server did not become ready"
}

managed_workspace() {
  herdr --session "$SESSION" workspace list 2>/dev/null | WORKSPACE_LABEL="$WORKSPACE_LABEL" node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const xs = JSON.parse(s).result?.workspaces ?? [];
        const w = xs.find(x => x.label === process.env.WORKSPACE_LABEL);
        if (w) process.stdout.write(w.workspace_id);
      } catch {}
    });
  '
}

root_pane() {
  local workspace_id="$1"
  herdr --session "$SESSION" pane list --workspace "$workspace_id" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const result = JSON.parse(s).result ?? {};
        const panes = result.panes ?? result.pane_list?.panes ?? [];
        if (panes[0]?.pane_id) process.stdout.write(panes[0].pane_id);
      } catch {}
    });
  '
}

create_workspace() {
  herdr --session "$SESSION" workspace create --cwd "$ROOT" --label "$WORKSPACE_LABEL" --no-focus \
    | node -e '
      let s = "";
      process.stdin.on("data", d => s += d).on("end", () => {
        const pane = JSON.parse(s).result?.root_pane?.pane_id;
        if (!pane) process.exit(1);
        process.stdout.write(pane);
      });
    '
}

pane_is_idle_shell() {
  local pane_id="$1"
  herdr --session "$SESSION" pane process-info --pane "$pane_id" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const ps = JSON.parse(s).result?.process_info?.foreground_processes ?? [];
        const shells = new Set(["bash", "zsh", "fish", "sh", "dash"]);
        process.exit(ps.length === 0 || ps.every(p => shells.has(p.name)) ? 0 : 1);
      } catch { process.exit(1); }
    });
  '
}

ensure_workspace_and_pi() {
  local workspace_id pane_id command_q command
  workspace_id="$(managed_workspace)"
  if [[ -z "$workspace_id" ]]; then
    log "creating managed workspace '$WORKSPACE_LABEL'"
    pane_id="$(create_workspace)"
  else
    pane_id="$(root_pane "$workspace_id")"
  fi
  [[ -n "$pane_id" ]] || die "could not resolve the managed workspace pane"

  if pane_is_idle_shell "$pane_id"; then
    if [[ -n "${GOPILOT_MANAGED_COMMAND:-}" ]]; then
      command="$GOPILOT_MANAGED_COMMAND"
    else
      printf -v command_q '%q' "$ROOT/scripts/pi-resume.sh"
      command="bash $command_q"
    fi
    log "starting or continuing Pi in $pane_id"
    herdr --session "$SESSION" pane run "$pane_id" "$command" >/dev/null
  else
    log "managed pane $pane_id is already active; leaving it untouched"
  fi
}

status() {
  require_runtime
  if ! session_running; then
    printf 'Go-pilot session: stopped\n'
    return 1
  fi
  printf 'Go-pilot session: running (headless server, session=%s)\n' "$SESSION"
  herdr --session "$SESSION" workspace list
}

main() {
  local action="${1:-attach}"
  require_runtime
  case "$action" in
    start)
      start_server
      ensure_workspace_and_pi
      log "headless runtime ready"
      ;;
    attach)
      start_server
      ensure_workspace_and_pi
      exec herdr --session "$SESSION"
      ;;
    status)
      status
      ;;
    snapshot)
      start_server
      herdr --session "$SESSION" api snapshot
      ;;
    stop)
      # Stop is explicit. Closing the TUI must never call this action.
      if session_running; then herdr session stop "$SESSION" --json; fi
      ;;
    restart)
      if session_running; then herdr session stop "$SESSION" --json >/dev/null; fi
      start_server
      ensure_workspace_and_pi
      ;;
    *)
      die "usage: $0 {attach|start|status|snapshot|stop|restart}"
      ;;
  esac
}

main "$@"
