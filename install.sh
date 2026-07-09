#!/usr/bin/env bash
#
# Go-pilot bootstrap — idempotent cross-platform installer (macOS + WSL/Ubuntu).
#
# Brings a fresh machine to a working Go-pilot "pure-anthropic core":
#   - ensures Node >=20, Docker, and the docker-compose plugin are present
#   - templates deploy/.env from the committed example (never overwrites)
#   - fetches the Mem0 build context (sparse clone) if missing
#   - brings up the Tier-2 memory stack (Mem0 + pgvector) via docker compose
#   - smoke-tests (node --test) and waits for Mem0 to answer on :8888
#
# IDEMPOTENCY: a second run makes NO destructive changes. Every install/mutation
# is guarded by a presence check (have / file-exists / dir-exists). Re-running only
# (re)starts already-built services and re-verifies. It never re-clones, never
# re-installs a present tool, and never overwrites an existing deploy/.env.
#
# The frontier plane (claude / codex) uses native subscription login — NO API keys
# needed. The only key Mem0 wants is OPENAI_API_KEY (embedder); fill it in deploy/.env.
#
# Usage:
#   ./install.sh              # core install (recommended)
#   ./install.sh --full       # also install the optional workhorse rig (Herdr + Pi)
#   GOPILOT_FULL=1 ./install.sh
#
# NOTE (WSL/Ubuntu): installing Docker adds you to the 'docker' group. That grant
# only applies to NEW shells — open a fresh terminal (or run `newgrp docker`) before
# the daemon socket is usable without sudo.

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve repo root (so the script works from any CWD) and cd into it.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="deploy/docker-compose.yml"
MEM0_URL="http://localhost:8888"
MEM0_SRC="deploy/mem0-src"

# --full flag OR GOPILOT_FULL=1 enables the optional workhorse rig.
FULL="${GOPILOT_FULL:-0}"
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
      exit 0 ;;
    *) echo "Unknown argument: $arg (use --full or --help)" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Logging + small helpers.
# ---------------------------------------------------------------------------
log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# Accumulated post-install TODOs, printed in the final report.
TODOS=()
add_todo() { TODOS+=("$1"); }

# ---------------------------------------------------------------------------
# OS detection: macos | wsl | linux. Abort on anything else.
# ---------------------------------------------------------------------------
detect_os() {
  local uname_s
  uname_s="$(uname -s)"
  case "$uname_s" in
    Darwin)
      echo "macos" ;;
    Linux)
      if grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi ;;
    *)
      die "Unsupported OS '$uname_s'. This installer supports macOS and WSL/Linux only.
     On Windows, run this inside WSL (Ubuntu), or use the PowerShell installer." ;;
  esac
}

OS="$(detect_os)"

# ---------------------------------------------------------------------------
# Node major-version check (need >= 20).
# ---------------------------------------------------------------------------
node_major() {
  # Prints the major version integer, or 0 if node is absent/unparsable.
  local v
  v="$(node -v 2>/dev/null || true)"      # e.g. v22.23.1
  v="${v#v}"                               # 22.23.1
  v="${v%%.*}"                             # 22
  [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo "0"
}

# ===========================================================================
# SECTION 1 — Core tool checks (idempotent).
# ===========================================================================

ensure_node() {
  log "Node.js (>= 20)"
  if have node && [[ "$(node_major)" -ge 20 ]]; then
    info "present ($(node -v)), skipping"
    return 0
  fi

  if have node; then
    warn "node $(node -v) is present but < 20 — Go-pilot needs >= 20."
  fi

  case "$OS" in
    macos)
      have brew || die "Homebrew not found — cannot install Node. Install brew first:
     /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"
     then re-run ./install.sh"
      info "installing node via Homebrew…"
      brew install node ;;
    wsl|linux)
      # NodeSource gives a current, predictable major. Ubuntu's own 'nodejs' apt
      # package can lag (older major) — hence NodeSource for the >=20 guarantee.
      info "installing Node 20.x via NodeSource…"
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y nodejs ;;
  esac

  have node && [[ "$(node_major)" -ge 20 ]] || die "Node install did not yield >= 20."
  info "installed $(node -v)"
}

ensure_docker() {
  log "Docker engine"
  if have docker; then
    info "present ($(docker --version 2>/dev/null || echo 'docker')), skipping"
    return 0
  fi

  case "$OS" in
    macos)
      have brew || die "Homebrew not found — cannot install Docker. Install brew first, or
     install Docker Desktop manually: https://www.docker.com/products/docker-desktop/"
      info "installing Docker Desktop via Homebrew cask…"
      brew install --cask docker
      add_todo "Launch Docker Desktop once so the engine starts (Applications > Docker)." ;;
    wsl|linux)
      info "installing docker.io + docker-compose-v2 via apt…"
      sudo apt-get update
      sudo apt-get install -y docker.io docker-compose-v2
      # Start + enable the daemon. Prefer systemd; fall back to the service wrapper
      # for WSL images without systemd enabled.
      if have systemctl && systemctl list-unit-files >/dev/null 2>&1; then
        sudo systemctl enable --now docker || true
      else
        sudo service docker start || true
        add_todo "systemd not detected — start the daemon each session with: sudo service docker start"
      fi
      # Let the current user reach the socket without sudo (new shell required).
      sudo usermod -aG docker "$USER" || true
      add_todo "You were added to the 'docker' group — open a NEW shell (or 'newgrp docker') for it to take effect." ;;
  esac

  have docker || die "Docker install failed — 'docker' still not on PATH."
  info "installed $(docker --version 2>/dev/null || echo docker)"
}

ensure_compose() {
  log "docker compose plugin"
  if docker compose version >/dev/null 2>&1; then
    info "present ($(docker compose version --short 2>/dev/null || echo 'compose v2')), skipping"
    return 0
  fi

  case "$OS" in
    macos)
      warn "docker compose plugin missing — it ships with Docker Desktop."
      add_todo "Ensure Docker Desktop is installed and running (it bundles 'docker compose')." ;;
    wsl|linux)
      info "installing docker-compose-v2 via apt…"
      sudo apt-get update
      sudo apt-get install -y docker-compose-v2 ;;
  esac

  docker compose version >/dev/null 2>&1 \
    || warn "docker compose still unavailable — you may need Docker Desktop (mac) or a new shell (WSL)."
}

# ===========================================================================
# SECTION 2 — Optional workhorse rig (Herdr + Pi), gated behind --full.
# ===========================================================================

ensure_full_rig() {
  [[ "$FULL" == "1" ]] || { info "workhorse rig skipped (pass --full or GOPILOT_FULL=1 to include)"; return 0; }

  log "Optional workhorse rig (Herdr + Pi)"
  have npm || { warn "npm not found — cannot install Pi. Skipping rig."; return 0; }

  if have pi; then
    info "pi present, skipping"
  else
    info "installing Pi (pi-coding-agent)…"
    npm i -g --ignore-scripts @earendil-works/pi-coding-agent
  fi

  if have herdr; then
    info "herdr present, skipping"
  else
    warn "herdr not installed — install per docs/environments.md:"
    info "  macOS: brew install herdr   |   mac/WSL: curl -fsSL https://herdr.dev/install.sh | sh"
    add_todo "Install Herdr (workhorse terminal substrate) — see docs/environments.md."
  fi
}

# ===========================================================================
# SECTION 3 — Config templating (idempotent — never overwrites).
# ===========================================================================

ensure_env() {
  log "Config: deploy/.env"
  if [[ -f deploy/.env ]]; then
    info "deploy/.env exists, leaving as-is"
    return 0
  fi
  [[ -f deploy/.env.example ]] || die "deploy/.env.example is missing — cannot template deploy/.env."
  cp deploy/.env.example deploy/.env
  info "created deploy/.env — fill OPENAI_API_KEY (embedder key for Mem0 search)."
  add_todo "Fill OPENAI_API_KEY in deploy/.env (Mem0 embedder key)."
}

# ===========================================================================
# SECTION 4 — Mem0 build context (sparse clone, guarded).
# ===========================================================================

ensure_mem0_src() {
  log "Mem0 build context: $MEM0_SRC"
  if [[ -d "$MEM0_SRC/server" ]]; then
    info "$MEM0_SRC/server present, skipping clone"
    return 0
  fi
  have git || die "git not found — needed to fetch the Mem0 build context."
  info "sparse-cloning mem0 server (blobless, depth 1)…"
  git clone --filter=blob:none --no-checkout --depth 1 \
    https://github.com/mem0ai/mem0.git "$MEM0_SRC"
  ( cd "$MEM0_SRC" && git sparse-checkout set server && git checkout )
  [[ -d "$MEM0_SRC/server" ]] || die "sparse checkout did not produce $MEM0_SRC/server."
  info "fetched $MEM0_SRC/server"
}

# ===========================================================================
# SECTION 5 — Bring up services.
# ===========================================================================

bring_up_services() {
  log "Bringing up Mem0 + pgvector (docker compose up -d)"
  if ! docker compose version >/dev/null 2>&1; then
    warn "docker compose unavailable in this shell — skipping service bring-up."
    add_todo "Re-run ./install.sh in a shell where 'docker compose' works to start Mem0."
    return 0
  fi
  # First run builds the Mem0 image from the sparse checkout; re-runs are a no-op
  # for already-built/running services (compose is declarative + idempotent).
  docker compose -f "$COMPOSE_FILE" up -d
}

# ===========================================================================
# SECTION 6 — Verify + READY report.
# ===========================================================================

TEST_RESULT="skipped"
run_smoke_tests() {
  log "Smoke test: node --test"
  if ! have node; then
    warn "node absent — skipping tests."
    return 0
  fi
  # Non-fatal: a test failure should not abort the installer or hide the report.
  if node --test >/dev/null 2>&1; then
    TEST_RESULT="passed"
    info "node --test passed"
  else
    TEST_RESULT="FAILED"
    warn "node --test reported failures — run 'node --test' directly to see details."
  fi
}

MEM0_STATUS="not-checked"
wait_for_mem0() {
  log "Waiting for Mem0 at ${MEM0_URL}/docs (up to ~120s)"
  if ! have curl; then
    warn "curl not found — cannot poll Mem0. Skipping health check."
    MEM0_STATUS="unknown (no curl)"
    return 0
  fi
  if ! docker compose version >/dev/null 2>&1; then
    MEM0_STATUS="not-started (no compose)"
    return 0
  fi

  local code
  for _ in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${MEM0_URL}/docs" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      MEM0_STATUS="up (HTTP 200)"
      info "Mem0 is up."
      return 0
    fi
    sleep 2
  done
  MEM0_STATUS="DID NOT COME UP"
  warn "Mem0 did not answer 200 within ~120s (last code: ${code:-none})."
  warn "Debug with: docker compose -f $COMPOSE_FILE logs mem0"
  add_todo "Mem0 did not come up — inspect: docker compose -f $COMPOSE_FILE logs mem0"
}

final_report() {
  local node_v docker_v compose_v
  node_v="$(node -v 2>/dev/null || echo 'absent')"
  docker_v="$(docker --version 2>/dev/null || echo 'absent')"
  compose_v="$(docker compose version --short 2>/dev/null || echo 'absent')"

  printf '\n\033[1;32m========================================\033[0m\n'
  printf '\033[1;32m ✅ Go-pilot ready\033[0m\n'
  printf '\033[1;32m========================================\033[0m\n'
  printf '  OS              : %s\n' "$OS"
  printf '  Node            : %s\n' "$node_v"
  printf '  Docker          : %s\n' "$docker_v"
  printf '  docker compose  : %s\n' "$compose_v"
  printf '  Mem0 URL        : %s  (%s)\n' "$MEM0_URL" "$MEM0_STATUS"
  printf '  node --test     : %s\n' "$TEST_RESULT"
  printf '  Full rig (--full): %s\n' "$([[ "$FULL" == "1" ]] && echo enabled || echo skipped)"

  if [[ ${#TODOS[@]} -gt 0 ]]; then
    printf '\n\033[1;33m  TODO:\033[0m\n'
    for t in "${TODOS[@]}"; do
      printf '   • %s\n' "$t"
    done
  else
    printf '\n  No outstanding TODOs.\n'
  fi
  printf '\n  Re-running ./install.sh is safe — it makes no destructive changes.\n\n'
}

# ===========================================================================
# MAIN
# ===========================================================================
main() {
  log "Go-pilot installer — detected OS: $OS"

  ensure_node
  ensure_docker
  ensure_compose
  ensure_full_rig

  ensure_env
  ensure_mem0_src
  bring_up_services

  run_smoke_tests
  wait_for_mem0

  final_report
}

# Run main only when executed directly — sourcing (for tests) defines the
# functions without side effects.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
