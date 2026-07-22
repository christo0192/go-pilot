#!/usr/bin/env bash
#
# Go-pilot bootstrap — idempotent cross-platform installer (macOS + WSL/Ubuntu).
#
# Brings a fresh machine to a working Go-pilot "pure-anthropic core":
#   - ensures Node >=22, Docker, and the docker-compose plugin are present
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
#   ./install.sh --tools      # also install the trader doc-toolkit (user-local, no sudo)
#   GOPILOT_FULL=1 ./install.sh
#   GOPILOT_TOOLS=1 ./install.sh
#
# The doc-toolkit (yazi, glow, visidata, pandoc, weasyprint) installs entirely
# under ~/.local/bin — NO sudo, NO system packages. See docs/trader-workflow.md.
# The aesthetic Herdr theme (config/herdr-config.toml) is always installed to
# ~/.config/herdr/config.toml, but ONLY if you don't already have one (never
# clobbers; an existing config is backed up before any replace).
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
# --tools flag OR GOPILOT_TOOLS=1 enables the trader doc-toolkit (user-local).
TOOLS="${GOPILOT_TOOLS:-0}"
# --doctor: verify-only mode — checks every piece, changes NOTHING, exit 0 with
# a report (missing pieces become TODOs). Used by CI and for quick health checks.
DOCTOR=0
# --one-click: fully unattended install (used by setup.cmd / setup-macos.command).
# Implies --full, forces non-interactive apt, auto-installs herdr, persists PATH
# entries, and injects $GOPILOT_WORKHORSE_KEY into deploy/.env when provided.
ONE_CLICK="${GOPILOT_ONE_CLICK:-0}"
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --tools) TOOLS=1 ;;
    --doctor) DOCTOR=1 ;;
    --one-click) ONE_CLICK=1 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
      exit 0 ;;
    *) echo "Unknown argument: $arg (use --full, --tools, --doctor, --one-click or --help)" >&2; exit 2 ;;
  esac
done
if [[ "$ONE_CLICK" == "1" ]]; then
  FULL=1
  export DEBIAN_FRONTEND=noninteractive
fi

# Known-good tool versions (reproducibility + supply chain). Override via env.
PI_VERSION="${GOPILOT_PI_VERSION:-0.81.1}"
HERDR_VERSION="${GOPILOT_HERDR_VERSION:-0.7.3}"
CLAUDE_VERSION="${GOPILOT_CLAUDE_VERSION:-2.1.215}"
CODEX_VERSION="${GOPILOT_CODEX_VERSION:-0.144.6}"

run_doctor() {
  log "Doctor: verify-only (nothing will be changed)"
  local checks=0 okc=0
  chk() { # $1 label, $2 command
    checks=$((checks + 1))
    if eval "$2" >/dev/null 2>&1; then okc=$((okc + 1)); info "OK   $1"
    else warn "MISS $1"; add_todo "$1"; fi
  }
  chk "node >= 22"                       'have node && [ "$(node -e "console.log(process.versions.node.split(\".\")[0])")" -ge 22 ]'
  chk "git present"                      'have git'
  chk "docker present (Mem0/LiteLLM)"    'have docker'
  chk "pi present (workhorse agents)"    'have pi'
  chk "herdr present (pane orchestration)" 'have herdr'
  chk "claude present (frontier agent)"    'have claude'
  chk "codex present (frontier agent)"     'have codex'
  chk "deploy/.env exists"               '[ -f deploy/.env ]'
  chk "WORKHORSE_GATEWAY_KEY set in deploy/.env" 'grep -qE "^WORKHORSE_GATEWAY_KEY=.+" deploy/.env'
  chk "deploy/.env permissions 600"      '[ "$(stat -c %a deploy/.env 2>/dev/null || stat -f %Lp deploy/.env)" = "600" ]'
  chk "pi-delegate on PATH"              '[ -e "$HOME/.local/bin/pi-delegate" ]'
  chk "Pi ikey provider registered"      'grep -q "\"ikey\"" "$HOME/.pi/agent/models.json"'
  chk "global orchestrate skill"         '[ -f "$HOME/.claude/skills/gopilot-orchestrate/SKILL.md" ]'
  chk "official Herdr skill for Pi"       '[ -f "$HOME/.pi/agent/skills/herdr/SKILL.md" ]'
  chk "official Herdr skill for Claude"   '[ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/herdr/SKILL.md" ]'
  chk "official Herdr skill for Codex"    '[ -f "${CODEX_HOME:-$HOME/.codex}/skills/herdr/SKILL.md" ]'
  chk "Herdr Pi integration installed"    'herdr integration status | grep -qE "^pi: (current|installed)"'
  chk "Herdr Claude integration installed" 'herdr integration status | grep -qE "^claude: (current|installed)"'
  chk "Herdr Codex integration installed" 'herdr integration status | grep -qE "^codex: (current|installed)"'
  chk "Go-pilot Pi skills registered"     'grep -qF '"'"'.pi/skills'"'"' "$HOME/.pi/agent/settings.json"'
  chk "Pi tool-call repair registered"    'grep -qF '"'"'tool-call-repair.ts'"'"' "$HOME/.pi/agent/settings.json"'
  chk "repo CLAUDE.md present"           '[ -f CLAUDE.md ]'
  chk "unit tests pass"                  'node scripts/run-tests.mjs unit'
  log "Doctor: $okc/$checks checks OK"
  final_report
  exit 0
}

# ---------------------------------------------------------------------------
# Logging + small helpers.
# ---------------------------------------------------------------------------
log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mFATAL: %s\033[0m\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

sha256_file() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else die "No SHA-256 tool found (need sha256sum or shasum)."
  fi
}

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
# Node major-version check (need >= 22).
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
  log "Node.js (>= 22)"
  if have node && [[ "$(node_major)" -ge 22 ]]; then
    info "present ($(node -v)), skipping"
    return 0
  fi

  if have node; then
    warn "node $(node -v) is present but < 22 — current Claude Code needs >= 22."
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
      # package can lag (older major) — hence NodeSource for the >=22 guarantee.
      info "installing Node 22.x via NodeSource…"
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs ;;
  esac

  have node && [[ "$(node_major)" -ge 22 ]] || die "Node install did not yield >= 22."
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

install_herdr_official() {
  have curl || die "curl is required to download Herdr from its official GitHub release."

  local platform arch asset expected actual tmp version_ref
  case "$OS" in
    macos) platform="macos" ;;
    wsl|linux) platform="linux" ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch="x86_64" ;;
    arm64|aarch64) arch="aarch64" ;;
    *) die "Herdr has no pinned binary for architecture $(uname -m)." ;;
  esac

  asset="herdr-${platform}-${arch}"
  expected="${GOPILOT_HERDR_SHA256:-}"
  if [[ -z "$expected" && "$HERDR_VERSION" == "0.7.3" ]]; then
    case "$asset" in
      herdr-linux-x86_64) expected="043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d" ;;
      herdr-linux-aarch64) expected="ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1" ;;
      herdr-macos-x86_64) expected="9b5f35d283b0877eeda0cf66ba1ef1d95ae40f32e858a04da0041f3a20df027c" ;;
      herdr-macos-aarch64) expected="b31345392d004ec1f1b2c821e1ad601019fa8385fe1e4c6931321eb58a920773" ;;
    esac
  fi
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] \
    || die "No trusted Herdr SHA-256 is pinned for v${HERDR_VERSION} ${asset}. Set GOPILOT_HERDR_SHA256 explicitly."

  version_ref="v${HERDR_VERSION#v}"
  tmp="$(mktemp)"
  if ! curl -fsSL "https://github.com/ogulcancelik/herdr/releases/download/${version_ref}/${asset}" -o "$tmp"; then
    rm -f "$tmp"
    die "Could not download the official Herdr ${version_ref} ${asset} release."
  fi
  actual="$(sha256_file "$tmp" | tr '[:upper:]' '[:lower:]')"
  expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$tmp"
    die "Herdr checksum mismatch for ${asset}: expected ${expected}, got ${actual}."
  fi
  mkdir -p "$HOME/.local/bin"
  install -m 0755 "$tmp" "$HOME/.local/bin/herdr"
  rm -f "$tmp"
  export PATH="$HOME/.local/bin:$PATH"
  info "installed official Herdr ${version_ref} (${asset}, SHA-256 verified)"
}

ensure_full_rig() {
  [[ "$FULL" == "1" ]] || { info "workhorse rig skipped (pass --full or GOPILOT_FULL=1 to include)"; return 0; }

  log "Optional workhorse rig (Herdr + Pi)"
  have npm || die "npm not found — cannot install the agent CLIs."

  # Never install user-facing CLIs into root-owned /usr. This keeps updates and
  # subscription credentials in the WSL/macOS user's home directory.
  local npm_prefix="$HOME/.npm-global"
  mkdir -p "$npm_prefix"
  npm config set prefix "$npm_prefix"
  export PATH="$HOME/.local/bin:$npm_prefix/bin:$PATH"

  local installed_pi_version=""
  have pi && installed_pi_version="$(pi --version 2>/dev/null | awk 'NR == 1 { print $NF }' || true)"
  if [[ "$installed_pi_version" == "${PI_VERSION#v}" ]]; then
    info "pi ${PI_VERSION#v} present, skipping"
  else
    info "installing/updating official Pi (pi-coding-agent) @ ${PI_VERSION} (pinned; override GOPILOT_PI_VERSION)…"
    npm i -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}"
    [[ "$(pi --version 2>/dev/null | awk 'NR == 1 { print $NF }')" == "${PI_VERSION#v}" ]] \
      || die "Pi install did not yield pinned version ${PI_VERSION#v}."
  fi

  if have herdr && [[ "$(herdr --version 2>/dev/null | awk '{print $NF}')" == "${HERDR_VERSION#v}" ]]; then
    info "herdr ${HERDR_VERSION#v} present, skipping"
  else
    info "installing Herdr ${HERDR_VERSION#v} from the official GitHub release…"
    install_herdr_official
    have herdr || die "Herdr installed but is not on PATH."
  fi

  persist_path_entries
}

ensure_frontier_clis() {
  [[ "$FULL" == "1" ]] || return 0
  log "Frontier agents (Claude Code + Codex CLI)"
  have npm || die "npm is required to install Claude Code and Codex CLI."

  local npm_prefix="$HOME/.npm-global"
  mkdir -p "$npm_prefix"
  npm config set prefix "$npm_prefix"
  export PATH="$HOME/.local/bin:$npm_prefix/bin:$PATH"

  if have claude; then
    info "claude present ($(claude --version 2>/dev/null | head -1)), skipping"
  else
    info "installing Claude Code for the current user"
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_VERSION}"
    have claude || die "Claude Code installed but 'claude' is not on PATH."
  fi

  if have codex; then
    info "codex present ($(codex --version 2>/dev/null | head -1)), skipping"
  else
    info "installing Codex CLI for the current user"
    npm install -g "@openai/codex@${CODEX_VERSION}"
    have codex || die "Codex CLI installed but 'codex' is not on PATH."
  fi

  info "Subscription credentials are not collected by Go-pilot. Run each CLI once to sign in."
  persist_path_entries
}

install_verified_herdr_skill() {
  local lock="deploy/herdr-skill.lock.json" url expected actual tmp destination
  local claude_config_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  local codex_config_dir="${CODEX_HOME:-$HOME/.codex}"
  [[ -f "$lock" ]] || die "Missing $lock; cannot verify the official Herdr skill."
  url="$(node -e 'const x=require("./deploy/herdr-skill.lock.json"); process.stdout.write(x.url)' 2>/dev/null)"
  expected="$(node -e 'const x=require("./deploy/herdr-skill.lock.json"); process.stdout.write(x.sha256)' 2>/dev/null)"
  [[ "$url" == https://raw.githubusercontent.com/ogulcancelik/herdr/*/SKILL.md ]] \
    || die "Herdr skill lock points outside the official repository."
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "Herdr skill lock has an invalid SHA-256."

  tmp="$(mktemp)"
  if ! curl -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"
    die "Could not download the locked official Herdr skill."
  fi
  actual="$(sha256_file "$tmp")"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$tmp"
    die "Official Herdr skill checksum mismatch: expected ${expected}, got ${actual}."
  fi

  for destination in \
    "$HOME/.pi/agent/skills/herdr/SKILL.md" \
    "$claude_config_dir/skills/herdr/SKILL.md" \
    "$codex_config_dir/skills/herdr/SKILL.md"; do
    mkdir -p "$(dirname "$destination")"
    install -m 0644 "$tmp" "$destination"
  done
  rm -f "$tmp"
  info "installed verified official Herdr command skill for Pi, Claude, and Codex"
}

ensure_agent_integrations() {
  [[ "$FULL" == "1" ]] || return 0
  log "Official Herdr integrations + agent command skills"
  have herdr || die "Herdr is required before its agent integrations can be installed."
  have node || die "Node is required to merge Pi resources safely."

  # Herdr intentionally refuses to guess Pi's global resource root when the
  # extension directory has never existed. Seed only the standard directories;
  # the official integration command owns the files it places inside them.
  mkdir -p "$HOME/.pi/agent/extensions" \
    "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CODEX_HOME:-$HOME/.codex}"

  local integration
  for integration in pi claude codex; do
    if herdr integration install "$integration" >/dev/null; then
      info "installed Herdr ${integration} integration"
    elif [[ "$ONE_CLICK" == "1" ]]; then
      die "Herdr could not install its ${integration} integration."
    else
      warn "Herdr could not install its ${integration} integration."
      add_todo "Run: herdr integration install ${integration}"
    fi
  done

  install_verified_herdr_skill
  node scripts/install-pi-resources.mjs "$HOME/.pi/agent/settings.json" "$PWD"
  info "registered Go-pilot's Pi skills and tool-call repair extension globally"
}

# Make ~/.local/bin and the npm global bin dir survive into FUTURE shells: the
# fresh-machine log showed pi/herdr installed but "command not found" in the next
# session because neither dir was on the persisted PATH. Idempotent (guarded by
# a marker) and appended to ~/.bashrc + ~/.zshrc when they exist / bash default.
persist_path_entries() {
  local npmbin=""
  have npm && npmbin="$(npm prefix -g 2>/dev/null)/bin"
  local marker="# gopilot: user-local tool PATH"
  local line="export PATH=\"\$HOME/.local/bin${npmbin:+:$npmbin}:\$PATH\""
  local rc
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ "$rc" == "$HOME/.bashrc" || -f "$rc" ]] || continue
    if [[ -f "$rc" ]] && grep -qF "$marker" "$rc"; then continue; fi
    printf '\n%s\n%s\n' "$marker" "$line" >> "$rc"
    info "persisted PATH (~/.local/bin${npmbin:+ + npm global bin}) -> $rc"
  done
}

# ===========================================================================
# SECTION 2b — Trader doc-toolkit (user-local, no sudo), gated behind --tools.
# ===========================================================================
#
# Everything here lands under ~/.local/bin (binaries) or uv's tool dir. Nothing
# needs root. Each install is guarded so a re-run is a no-op and a single
# failure never aborts the installer (all wrapped, warnings not fatal).

TOOLS_BIN="$HOME/.local/bin"

# Pinned versions (verified working). Bump deliberately.
YAZI_VER="v26.5.6"
GLOW_VER="v2.1.2"
PANDOC_VER="3.10"

# Fetch a github release tarball and extract one binary into ~/.local/bin.
#   _fetch_binary <name> <url> <tar-relative-path-to-binary>
_fetch_binary() {
  local name="$1" url="$2" inner="$3" tmp
  tmp="$(mktemp -d)"
  if curl -fsSL "$url" -o "$tmp/dl.tgz" 2>/dev/null \
     && tar xzf "$tmp/dl.tgz" -C "$tmp" 2>/dev/null \
     && [[ -f "$tmp/$inner" ]]; then
    install -m 0755 "$tmp/$inner" "$TOOLS_BIN/$name"
    rm -rf "$tmp"
    return 0
  fi
  rm -rf "$tmp"
  return 1
}

ensure_tools() {
  [[ "$TOOLS" == "1" ]] || { info "doc-toolkit skipped (pass --tools or GOPILOT_TOOLS=1 to include)"; return 0; }

  log "Trader doc-toolkit (user-local → $TOOLS_BIN, no sudo)"
  mkdir -p "$TOOLS_BIN"

  case ":$PATH:" in
    *":$TOOLS_BIN:"*) : ;;
    *) warn "$TOOLS_BIN is not on your PATH — add it to your shell rc:"
       info 'export PATH="$HOME/.local/bin:$PATH"'
       add_todo "Add ~/.local/bin (and ~/.npm-global/bin) to PATH so the doc-toolkit is callable." ;;
  esac

  have curl || { warn "curl not found — cannot download toolkit binaries. Skipping."; return 0; }

  # --- glow (markdown viewer) ------------------------------------------------
  if have glow; then
    info "glow present ($(glow --version 2>/dev/null | head -1)), skipping"
  elif _fetch_binary glow \
        "https://github.com/charmbracelet/glow/releases/download/${GLOW_VER}/glow_${GLOW_VER#v}_Linux_x86_64.tar.gz" \
        "glow_${GLOW_VER#v}_Linux_x86_64/glow"; then
    info "installed glow $($TOOLS_BIN/glow --version 2>/dev/null | head -1)"
  else
    warn "glow download failed."; add_todo "Install glow manually: https://github.com/charmbracelet/glow/releases"
  fi

  # --- pandoc (md → docx/html/pdf) ------------------------------------------
  if have pandoc; then
    info "pandoc present ($(pandoc --version 2>/dev/null | head -1)), skipping"
  elif _fetch_binary pandoc \
        "https://github.com/jgm/pandoc/releases/download/${PANDOC_VER}/pandoc-${PANDOC_VER}-linux-amd64.tar.gz" \
        "pandoc-${PANDOC_VER}/bin/pandoc"; then
    info "installed $($TOOLS_BIN/pandoc --version 2>/dev/null | head -1)"
  else
    warn "pandoc download failed."; add_todo "Install pandoc manually: https://github.com/jgm/pandoc/releases"
  fi

  # --- yazi (file manager + previews) ---------------------------------------
  # Ships as a .zip; extract with unzip if present, else python3's zipfile.
  if have yazi; then
    info "yazi present ($(yazi --version 2>/dev/null)), skipping"
  else
    local ytmp yzip yinner
    ytmp="$(mktemp -d)"
    yzip="$ytmp/yazi.zip"
    if curl -fsSL "https://github.com/sxyazi/yazi/releases/download/${YAZI_VER}/yazi-x86_64-unknown-linux-musl.zip" -o "$yzip" 2>/dev/null; then
      if have unzip; then
        unzip -o -q "$yzip" -d "$ytmp" 2>/dev/null || true
      elif have python3; then
        python3 -c "import zipfile,sys; zipfile.ZipFile('$yzip').extractall('$ytmp')" 2>/dev/null || true
      else
        warn "neither unzip nor python3 available — cannot extract yazi."
      fi
      yinner="$(find "$ytmp" -maxdepth 2 -type f -name yazi 2>/dev/null | head -1)"
      if [[ -n "$yinner" ]]; then
        install -m 0755 "$yinner" "$TOOLS_BIN/yazi"
        # 'ya' is yazi's companion CLI (plugin/keymap helper) — install if bundled.
        local yahelper
        yahelper="$(find "$ytmp" -maxdepth 2 -type f -name ya 2>/dev/null | head -1)"
        [[ -n "$yahelper" ]] && install -m 0755 "$yahelper" "$TOOLS_BIN/ya"
        info "installed yazi $($TOOLS_BIN/yazi --version 2>/dev/null)"
      else
        warn "yazi archive did not contain the binary."; add_todo "Install yazi manually: https://github.com/sxyazi/yazi/releases"
      fi
    else
      warn "yazi download failed."; add_todo "Install yazi manually: https://github.com/sxyazi/yazi/releases"
    fi
    rm -rf "$ytmp"
  fi

  # --- visidata (CSV/XLSX/JSON viewer) via uv --------------------------------
  if have vd; then
    info "visidata present ($(vd --version 2>/dev/null)), skipping"
  elif have uv; then
    info "installing visidata via uv…"
    uv tool install visidata >/dev/null 2>&1 \
      && info "installed visidata ($($TOOLS_BIN/vd --version 2>/dev/null))" \
      || { warn "uv tool install visidata failed."; add_todo "Install visidata: uv tool install visidata"; }
  else
    warn "uv not found — skipping visidata."; add_todo "Install visidata: uv tool install visidata (needs uv)"
  fi

  # --- weasyprint (PDF engine for pandoc) via uv -----------------------------
  # Note: weasyprint renders true PDFs if pango/cairo system libs are present
  # (they usually are on desktop distros). If not, md2pdf.sh falls back to the
  # HTML/browser-print path and md2docx.sh (native pandoc) always works.
  if have weasyprint; then
    info "weasyprint present ($(weasyprint --version 2>/dev/null | head -1)), skipping"
  elif have uv; then
    info "installing weasyprint via uv (PDF engine)…"
    uv tool install weasyprint >/dev/null 2>&1 \
      && info "installed weasyprint ($($TOOLS_BIN/weasyprint --version 2>/dev/null | head -1))" \
      || { warn "weasyprint install failed — md2pdf.sh will fall back to HTML/browser-print or md2docx.sh.";
           add_todo "Optional: uv tool install weasyprint (true md→PDF). Otherwise use md2docx.sh / browser-print."; }
  else
    warn "uv not found — skipping weasyprint (md2pdf.sh falls back to HTML/docx)."
  fi

  info "doc-toolkit done — see docs/trader-workflow.md for usage."
}

# ===========================================================================
# SECTION 2c — Aesthetic Herdr theme (idempotent — never clobbers).
# ===========================================================================
#
# Always runs. Copies config/herdr-config.toml → ~/.config/herdr/config.toml
# ONLY if no config exists there. If one exists we leave it untouched (a diff
# is offered via a .bak only when the user explicitly re-copies by hand).

ensure_herdr_config() {
  log "Aesthetic Herdr theme (~/.config/herdr/config.toml)"
  local src="config/herdr-config.toml"
  local dst="$HOME/.config/herdr/config.toml"

  [[ -f "$src" ]] || { warn "$src missing in repo — skipping herdr theme."; return 0; }

  if [[ -f "$dst" ]]; then
    info "existing herdr config found — leaving it untouched (never clobbered)."
    info "to adopt the shipped theme: cp $src $dst  (back up your own first)."
    return 0
  fi

  mkdir -p "$(dirname "$dst")"
  # Defensive: if a non-regular file somehow sits at $dst, back it up not clobber.
  if [[ -e "$dst" && ! -f "$dst" ]]; then
    mv "$dst" "$dst.bak.$(date +%s)"
    warn "backed up a pre-existing non-file at $dst"
  fi
  cp "$src" "$dst"
  info "installed aesthetic theme → $dst (Catppuccin, auto light/dark, mauve accent)."
  info "reload live with: herdr server reload-config"
}

# ===========================================================================
# SECTION 3 — Config templating (idempotent — never overwrites).
# ===========================================================================

ensure_env() {
  log "Config: deploy/.env"
  if [[ ! -f deploy/.env ]]; then
    [[ -f deploy/.env.example ]] || die "deploy/.env.example is missing — cannot template deploy/.env."
    cp deploy/.env.example deploy/.env
    chmod 600 deploy/.env
    info "created deploy/.env (chmod 600) — fill OPENAI_API_KEY (embedder key for Mem0 search)."
    add_todo "Fill OPENAI_API_KEY in deploy/.env (Mem0 embedder key)."
  else
    info "deploy/.env exists, leaving as-is"
  fi
  # One-click key injection: place the workhorse key in the CORRECT field. A
  # first-time user previously pasted it into OPENAI_API_KEY by hand and the
  # workers silently had no key. Only fills an EMPTY field — never overwrites.
  if [[ -n "${GOPILOT_WORKHORSE_KEY:-}" ]]; then
    if grep -qE '^WORKHORSE_GATEWAY_KEY=.+' deploy/.env; then
      info "WORKHORSE_GATEWAY_KEY already set — leaving it untouched"
    else
      # Node performs a literal replacement; shell metacharacters in a key are
      # data, never part of a sed expression or command line.
      node scripts/set-env-key.mjs deploy/.env WORKHORSE_GATEWAY_KEY
      chmod 600 deploy/.env
      info "injected WORKHORSE_GATEWAY_KEY into deploy/.env"
    fi
  fi
}

ensure_orchestrator() {
  log "Orchestrator: pi-delegate on PATH + Pi provider + global skill"

  # 1) pi-delegate shim (idempotent symlink) — lets ANY repo delegate to workhorses.
  mkdir -p "$HOME/.local/bin"
  ln -sf "$PWD/scripts/pi-delegate.sh" "$HOME/.local/bin/pi-delegate"
  info "symlinked ~/.local/bin/pi-delegate -> scripts/pi-delegate.sh"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) : ;;
    *) add_todo "Add ~/.local/bin to PATH (pi-delegate lives there)." ;;
  esac

  # 2) Pi "ikey" provider config (never clobbers an existing models.json).
  local picfg="$HOME/.pi/agent/models.json"
  if [[ -f deploy/pi-models.ikey.json ]]; then
    if [[ ! -f "$picfg" ]]; then
      mkdir -p "$HOME/.pi/agent"
      sed "s|__GOPILOT_REPO__|$PWD|g" deploy/pi-models.ikey.json > "$picfg"
      info "installed Pi workhorse provider -> $picfg"
    elif ! grep -q '"ikey"' "$picfg"; then
      warn "$picfg exists without an \"ikey\" provider"
      add_todo "Merge deploy/pi-models.ikey.json into ~/.pi/agent/models.json (replace __GOPILOT_REPO__ with $PWD)."
    else
      info "Pi provider already registered, leaving as-is"
    fi
  fi

  # 3) Global Claude Code skill — orchestration from ANY repo (idempotent overwrite:
  #    the template is the source of truth; re-running install updates it).
  if [[ -f deploy/global-skill.gopilot-orchestrate.md ]]; then
    mkdir -p "$HOME/.claude/skills/gopilot-orchestrate"
    sed "s|__GOPILOT_REPO__|$PWD|g" deploy/global-skill.gopilot-orchestrate.md \
      > "$HOME/.claude/skills/gopilot-orchestrate/SKILL.md"
    info "installed global skill -> ~/.claude/skills/gopilot-orchestrate/SKILL.md"
  fi
  add_todo "Optional: paste deploy/global-claude-md-snippet.md into ~/.claude/CLAUDE.md for auto-orchestration in every repo (in-repo it works without this)."
  add_todo "Fill WORKHORSE_GATEWAY_KEY in deploy/.env — the one key the workhorse plane needs."
}

# ===========================================================================
# SECTION 4 — Mem0 build context (sparse clone, guarded).
# ===========================================================================

ensure_mem0_src() {
  log "Mem0 build context: $MEM0_SRC"
  if [[ "$ONE_CLICK" == "1" ]] && ! grep -qE '^OPENAI_API_KEY=.+$' deploy/.env; then
    info "optional Mem0 is disabled; skipping its source download"
    return 0
  fi
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
  if ! grep -qE '^OPENAI_API_KEY=.+$' deploy/.env; then
    MEM0_STATUS="disabled (optional: add OPENAI_API_KEY)"
    info "OPENAI_API_KEY is blank; optional Mem0 memory remains disabled."
    return 0
  fi
  if ! docker compose version >/dev/null 2>&1; then
    warn "docker compose unavailable in this shell — skipping service bring-up."
    add_todo "Re-run ./install.sh in a shell where 'docker compose' works to start Mem0."
    return 0
  fi
  # The docker-group membership added by ensure_docker only applies to NEW
  # sessions — the fresh-machine log died right here on the socket. If the
  # socket is unreachable in THIS shell but passwordless sudo is available
  # (one-click runs after a root phase), fall through to sudo instead of failing.
  local compose=(docker compose)
  if ! docker info >/dev/null 2>&1; then
    if sudo -n true 2>/dev/null; then
      warn "docker socket not reachable in this session (group not active yet) — using sudo for this run."
      compose=(sudo docker compose)
    else
      warn "docker socket not reachable and sudo needs a password — skipping service bring-up."
      add_todo "Open a NEW shell (docker group takes effect) and run: docker compose -f $COMPOSE_FILE up -d"
      return 0
    fi
  fi
  # First run builds the Mem0 image from the sparse checkout; re-runs are a no-op
  # for already-built/running services (compose is declarative + idempotent).
  "${compose[@]}" -f "$COMPOSE_FILE" up -d
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
  if node --test >/dev/null 2>&1; then
    TEST_RESULT="passed"
    info "node --test passed"
  else
    TEST_RESULT="FAILED"
    warn "node --test reported failures — run 'node --test' directly to see details."
    [[ "$ONE_CLICK" == "1" ]] && die "Repository smoke tests failed; setup is not ready."
  fi
}

MEM0_STATUS="not-checked"
wait_for_mem0() {
  log "Waiting for Mem0 at ${MEM0_URL}/docs (up to ~120s)"
  [[ "$MEM0_STATUS" == disabled* ]] && return 0
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

validate_one_click() {
  [[ "$ONE_CLICK" == "1" ]] || return 0
  log "Final one-click acceptance gate"
  local failed=0 item
  for item in node git pi herdr claude codex; do
    if have "$item"; then info "OK   $item"
    else warn "MISS $item"; failed=1; fi
  done
  [[ -f deploy/.env ]] || { warn "MISS deploy/.env"; failed=1; }
  grep -qE '^WORKHORSE_GATEWAY_KEY=.+$' deploy/.env \
    || { warn "MISS WORKHORSE_GATEWAY_KEY"; failed=1; }
  for item in \
    "$HOME/.pi/agent/skills/herdr/SKILL.md" \
    "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/herdr/SKILL.md" \
    "${CODEX_HOME:-$HOME/.codex}/skills/herdr/SKILL.md"; do
    [[ -f "$item" ]] || { warn "MISS $item"; failed=1; }
  done
  herdr integration status | grep -qE '^pi: (current|installed)' \
    || { warn "MISS Herdr Pi integration"; failed=1; }
  herdr integration status | grep -qE '^claude: (current|installed)' \
    || { warn "MISS Herdr Claude integration"; failed=1; }
  herdr integration status | grep -qE '^codex: (current|installed)' \
    || { warn "MISS Herdr Codex integration"; failed=1; }
  grep -qF '.pi/skills' "$HOME/.pi/agent/settings.json" \
    || { warn "MISS Go-pilot Pi skills registration"; failed=1; }
  grep -qF 'tool-call-repair.ts' "$HOME/.pi/agent/settings.json" \
    || { warn "MISS Pi tool-call repair registration"; failed=1; }
  [[ "$TEST_RESULT" == "passed" ]] || { warn "FAIL repository tests"; failed=1; }
  [[ "$failed" == "0" ]] || die "Required acceptance checks failed. Fix the items above and re-run setup."
  info "All required local components are ready. Account sign-in is the only remaining interactive step."
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
  printf '  Doc-toolkit (--tools): %s\n' "$([[ "$TOOLS" == "1" ]] && echo enabled || echo skipped)"

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
  [[ "$DOCTOR" = "1" ]] && run_doctor

  ensure_node
  ensure_docker
  ensure_compose
  ensure_full_rig
  ensure_frontier_clis
  ensure_agent_integrations
  ensure_tools
  ensure_herdr_config

  ensure_env
  ensure_orchestrator
  ensure_mem0_src
  bring_up_services

  run_smoke_tests
  wait_for_mem0
  validate_one_click

  final_report
}

# Run main only when executed directly — sourcing (for tests) defines the
# functions without side effects.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
