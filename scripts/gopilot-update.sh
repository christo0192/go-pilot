#!/usr/bin/env bash
# Safe in-place updater for the installer-managed Go-pilot checkout.
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}/gopilot"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/gopilot"
CHANNEL_FILE="$CONFIG_HOME/update-channel"
STATE_FILE="$STATE_HOME/update-state.json"
CHANNEL=""
AUTO=0
ROLLBACK=0

log() { printf '[gopilot update] %s\n' "$*"; }
die() { log "ERROR: $*" >&2; exit "${2:-1}"; }

while (( $# > 0 )); do
  case "$1" in
    --channel)
      [[ $# -ge 2 ]] || die '--channel requires stable or nightly' 2
      CHANNEL="$2"; shift 2 ;;
    --auto) AUTO=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    -h|--help)
      printf 'usage: %s [--channel stable|nightly] [--auto] [--rollback]\n' "$0"; exit 0 ;;
    *) die "unknown option: $1" 2 ;;
  esac
done

mkdir -p "$STATE_HOME" "$CONFIG_HOME"
if [[ -z "$CHANNEL" ]]; then
  CHANNEL="$(cat "$CHANNEL_FILE" 2>/dev/null || printf stable)"
fi
[[ "$CHANNEL" == stable || "$CHANNEL" == nightly ]] || die "unsupported channel '$CHANNEL'" 2
printf '%s\n' "$CHANNEL" > "$CHANNEL_FILE"

command -v git >/dev/null 2>&1 || die 'git is required for updates'
command -v node >/dev/null 2>&1 || die 'node is required for updates'
git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$ROOT is not a Git checkout"

if ! git -C "$ROOT" diff --quiet || ! git -C "$ROOT" diff --cached --quiet; then
  die 'tracked local changes detected; update refused to protect your work' 20
fi

validate_candidate() {
  local commit="$1" stage
  stage="$(mktemp -d "${TMPDIR:-/tmp}/gopilot-update.XXXXXX")"
  if ! git -C "$ROOT" worktree add --quiet --detach "$stage" "$commit"; then
    rmdir "$stage" 2>/dev/null || true
    return 1
  fi
  if ! (
    cd "$stage"
    node scripts/run-tests.mjs unit
    node scripts/routing-consistency.mjs
  ); then
    git -C "$ROOT" worktree remove --force "$stage" >/dev/null 2>&1 || true
    return 1
  fi
  git -C "$ROOT" worktree remove --force "$stage" >/dev/null
}

if [[ "$ROLLBACK" == 1 ]]; then
  [[ -f "$STATE_FILE" ]] || die 'no previous update state is available to roll back' 23
  previous_commit="$(STATE_FILE="$STATE_FILE" node -e '
    const s = JSON.parse(require("fs").readFileSync(process.env.STATE_FILE, "utf8"));
    if (!/^[0-9a-f]{40}$/.test(s.previousCommit || "")) process.exit(1);
    process.stdout.write(s.previousCommit);
  ')" || die 'previous update state is invalid' 23
  git -C "$ROOT" cat-file -e "$previous_commit^{commit}" 2>/dev/null || die 'previous commit is no longer available locally' 23
  log "validating rollback target ${previous_commit:0:12}"
  validate_candidate "$previous_commit" || die 'rollback target failed validation; current version retained' 24
  current_commit="$(git -C "$ROOT" rev-parse HEAD)"
  log "rolling back ${current_commit:0:12} -> ${previous_commit:0:12}"
  git -C "$ROOT" reset --hard "$previous_commit" >/dev/null
  CURRENT_COMMIT="$current_commit" TARGET_COMMIT="$previous_commit" STATE_FILE="$STATE_FILE" node -e '
    const fs = require("fs");
    fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({
      previousCommit: process.env.CURRENT_COMMIT,
      installedCommit: process.env.TARGET_COMMIT,
      rolledBackAt: new Date().toISOString(),
    }, null, 2) + "\n", { mode: 0o600 });
  '
  (cd "$ROOT" && bash install.sh --full) || die 'rollback source activated, but dependency refresh needs attention' 22
  log 'rollback completed'
  exit 0
fi

log "checking $CHANNEL channel"
target_json="$(node "$ROOT/scripts/gopilot-update-target.mjs" "$CHANNEL")" || {
  [[ "$AUTO" == 1 ]] && { log 'update service unavailable; continuing with installed version'; exit 0; }
  exit 1
}
target_ref="$(printf '%s' "$target_json" | node -e '
  let s=""; process.stdin.on("data", d => s += d).on("end", () => process.stdout.write(JSON.parse(s).ref));
')"
target_sha_api="$(printf '%s' "$target_json" | node -e '
  let s=""; process.stdin.on("data", d => s += d).on("end", () => process.stdout.write(JSON.parse(s).sha || ""));
')"

git -C "$ROOT" fetch --quiet --prune --tags origin
if [[ "$CHANNEL" == nightly ]]; then
  target_commit="$(git -C "$ROOT" rev-parse 'origin/main^{commit}')"
  [[ "$target_commit" == "$target_sha_api" ]] || die 'origin/main does not match the commit whose CI result was verified'
else
  target_commit="$(git -C "$ROOT" rev-parse "$target_ref^{commit}")" || die "release tag '$target_ref' was not fetched"
fi
current_commit="$(git -C "$ROOT" rev-parse HEAD)"

if [[ "$current_commit" == "$target_commit" ]]; then
  log "already current ($CHANNEL ${current_commit:0:12})"
  exit 0
fi
if ! git -C "$ROOT" merge-base --is-ancestor "$current_commit" "$target_commit"; then
  if git -C "$ROOT" merge-base --is-ancestor "$target_commit" "$current_commit"; then
    log "installed commit is newer than $CHANNEL target; no downgrade performed"
    exit 0
  fi
  die 'installed checkout and update target have diverged; automatic merge refused' 21
fi

log "validating candidate ${target_commit:0:12} before activation"
validate_candidate "$target_commit" || die 'update candidate failed validation; installed version retained' 24

log "activating ${target_commit:0:12} (fast-forward only)"
git -C "$ROOT" merge --ff-only "$target_commit" >/dev/null

CURRENT_COMMIT="$current_commit" TARGET_COMMIT="$target_commit" UPDATE_CHANNEL="$CHANNEL" \
  TARGET_REF="$target_ref" STATE_FILE="$STATE_FILE" node -e '
    const fs = require("fs");
    fs.writeFileSync(process.env.STATE_FILE, JSON.stringify({
      previousCommit: process.env.CURRENT_COMMIT,
      installedCommit: process.env.TARGET_COMMIT,
      channel: process.env.UPDATE_CHANNEL,
      target: process.env.TARGET_REF,
      installedAt: new Date().toISOString(),
    }, null, 2) + "\n", { mode: 0o600 });
  '

# Refresh user-local shims/config from the newly activated source. The updater
# candidate already passed unit + routing gates, so a refresh failure is
# reported but never destroys the known-runnable checkout.
if ! (cd "$ROOT" && bash install.sh --full); then
  log 'WARNING: source updated successfully, but dependency refresh needs attention; run Go-pilot Doctor'
  exit 22
fi
log "updated successfully: ${current_commit:0:12} -> ${target_commit:0:12}"
