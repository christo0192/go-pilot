#!/bin/bash
# ===========================================================================
#  Go-pilot one-click setup for macOS.
#  Double-click this file in Finder (it opens its own Terminal window, which
#  BECOMES the herdr terminal at the end). One key paste, then unattended:
#    - Homebrew (if missing — Apple requires your macOS password ONCE for this)
#    - Node 20+, git, Docker Desktop (launched + waited on), herdr, Pi
#    - clones the repo to ~/Go-pilot and runs install.sh --one-click
#    - this window turns into the running herdr terminal
#  Safe to re-run: every step is idempotent.
# ===========================================================================
set -uo pipefail

echo
echo " ============================================================"
echo "  Go-pilot one-click setup (macOS)"
echo " ============================================================"
echo
echo "  Paste your WORKHORSE_GATEWAY_KEY (the one key the workhorse"
echo "  models need). Press Enter to skip — everything still installs,"
echo "  models activate when you add the key later."
echo
read -r -p "  Key: " GOPILOT_WORKHORSE_KEY
export GOPILOT_WORKHORSE_KEY

fail() { echo; echo "  Setup stopped: $*"; echo; read -r -p "Press Enter to close..." _; exit 1; }

echo
echo "[1/6] Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  # Apple gatekeeping: brew's installer needs sudo — the ONE password prompt
  # macOS forces on a fresh machine. NONINTERACTIVE skips its confirmations.
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || fail "Homebrew install failed"
fi
# Put brew on PATH for THIS shell (Apple Silicon vs Intel prefix).
for p in /opt/homebrew/bin /usr/local/bin; do
  [ -x "$p/brew" ] && eval "$("$p/brew" shellenv)" && break
done
command -v brew >/dev/null 2>&1 || fail "brew still not on PATH"
echo "  brew ok"

echo "[2/6] git..."
command -v git >/dev/null 2>&1 || brew install git || fail "git install failed"

echo "[3/6] Fetching Go-pilot into ~/Go-pilot..."
if [ -d "$HOME/Go-pilot/.git" ]; then
  git -C "$HOME/Go-pilot" pull --ff-only || fail "git pull failed"
else
  git clone https://github.com/christo0192/go-pilot.git "$HOME/Go-pilot" || fail "git clone failed"
fi

echo "[4/6] Docker Desktop (install if missing, launch, wait for the engine)..."
if ! command -v docker >/dev/null 2>&1; then
  brew install --cask docker || echo "  (Docker Desktop install failed — continuing; Mem0 stays off)"
fi
if command -v docker >/dev/null 2>&1 || [ -d "/Applications/Docker.app" ]; then
  open -ga Docker || true
  printf "  waiting for the Docker engine"
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then echo " — up"; break; fi
    printf "."; sleep 2
  done
  docker info >/dev/null 2>&1 || echo " — not up yet (Mem0 bring-up will be skipped; re-run later)"
fi

echo "[5/6] Installing the rig (herdr + Pi + provider + services)..."
cd "$HOME/Go-pilot" || fail "~/Go-pilot missing"
bash install.sh --one-click || fail "install.sh failed — scroll up for the first error"

echo "[6/6] Starting herdr — this window becomes the herdr terminal."
exec bash "$HOME/Go-pilot/scripts/oneclick-launch.sh"
