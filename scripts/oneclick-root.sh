#!/usr/bin/env bash
# Root phase of the one-click Windows/WSL setup. Invoked from setup.cmd as
# `wsl -u root bash <this> <phase> [user]` — `wsl -u root` needs NO password,
# which is what makes the whole flow unattended. Everything that requires root
# lives here so the USER phase never touches sudo (fresh Ubuntu WSL prompts for
# a password on sudo, which killed the previous manual install).
#
# Phases:
#   provision <username>  apt basics + Node 20 + Docker engine + docker group +
#                         systemd-on-boot (wsl.conf). Idempotent.
#   post-restart          start/enable the Docker daemon (after `wsl --shutdown`
#                         has rebooted the distro with systemd active).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n\033[1;36m==> [root] %s\033[0m\n' "$*"; }

PHASE="${1:?usage: oneclick-root.sh <provision|post-restart> [user]}"

case "$PHASE" in
  provision)
    TARGET_USER="${2:?provision needs the WSL username}"
    id "$TARGET_USER" >/dev/null 2>&1 || { echo "unknown user: $TARGET_USER" >&2; exit 2; }

    log "apt basics (git, curl, ca-certificates)"
    apt-get update -y
    apt-get install -y ca-certificates curl git

    log "Node.js >= 20"
    node_major() { node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
    if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 20 ]; then
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    fi
    echo "node $(node -v 2>/dev/null || echo missing)"

    log "Pi coding agent (global npm — root phase, because the NodeSource npm
     prefix is root-owned and a user-phase 'npm i -g' would die on EACCES)"
    if ! command -v pi >/dev/null 2>&1; then
      npm i -g --ignore-scripts "@earendil-works/pi-coding-agent@${GOPILOT_PI_VERSION:-0.80.6}"
    fi
    echo "pi $(pi --version 2>/dev/null | head -1 || echo missing)"

    log "Docker engine + compose plugin"
    apt-get install -y docker.io docker-compose-v2

    log "docker group for $TARGET_USER (takes effect after WSL restart)"
    usermod -aG docker "$TARGET_USER"

    log "systemd on boot (/etc/wsl.conf) so dockerd starts automatically"
    if ! grep -qs 'systemd=true' /etc/wsl.conf; then
      printf '\n[boot]\nsystemd=true\n' >> /etc/wsl.conf
      echo "systemd enabled — the caller must run 'wsl --shutdown' for it to apply"
    else
      echo "systemd already enabled"
    fi
    ;;

  post-restart)
    log "starting Docker daemon"
    if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files >/dev/null 2>&1; then
      systemctl enable --now docker
    else
      # systemd still not active (old WSL) — the classic service wrapper works.
      service docker start || true
    fi
    # Wait for the socket so the user phase's `docker compose up` never races it.
    for _ in $(seq 1 30); do
      docker info >/dev/null 2>&1 && { echo "docker daemon is up"; exit 0; }
      sleep 1
    done
    echo "warning: docker daemon did not come up within 30s (continuing)" >&2
    ;;

  *)
    echo "unknown phase: $PHASE" >&2
    exit 2
    ;;
esac
