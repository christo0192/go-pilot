#!/usr/bin/env bash
# Minimal advisory lock for panes that SHARE a checkout (S01/T04 write-safety).
# Primary write-safety = worktree-per-pane (herdr worktree; isolated branches). This lock
# is for the rarer case where panes intentionally operate on the same working tree.
# Fuller option (presence registry + broadcast inbox for parallel sessions) = claude-presence,
# deferred until needed.
#
# Usage:  scripts/pane-lock.sh <lockname> -- <command...>
#   Serializes the command across panes; second caller blocks until the first releases.
set -euo pipefail
LOCK="${1:?lockname required}"; shift
[ "${1:-}" = "--" ] && shift
LOCKFILE="${GOPILOT_LOCKDIR:-/tmp/gopilot-locks}/${LOCK}.lock"
mkdir -p "$(dirname "$LOCKFILE")"
exec 9>"$LOCKFILE"
flock 9                # advisory, blocks until acquired
"$@"                   # critical section
