#!/usr/bin/env bash
#
# md2docx.sh — turn a Markdown file into a Word .docx (zero-dep bash helper).
#
# Usage:
#   md2docx.sh <file.md> [out.docx]
#
# pandoc writes .docx natively — NO extra engine or system libs required, so
# this path always works once pandoc is installed. Great for traders who live
# in Excel/Word and want an editable, shareable doc from a Markdown journal.
#
# Install pandoc with:  ./install.sh --tools   (or GOPILOT_TOOLS=1)
# See docs/trader-workflow.md for the full doc pipeline.

set -euo pipefail

have() { command -v "$1" >/dev/null 2>&1; }
err()  { printf '\033[1;31mmd2docx: %s\033[0m\n' "$*" >&2; }
info() { printf '    %s\n' "$*" >&2; }

# --- args -------------------------------------------------------------------
if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
  exit "$([[ $# -lt 1 ]] && echo 2 || echo 0)"
fi

SRC="$1"
[[ -f "$SRC" ]] || { err "no such file: $SRC"; exit 2; }

OUT="${2:-${SRC%.*}.docx}"

if ! have pandoc; then
  err "pandoc is not installed — cannot convert Markdown to .docx."
  info "install it with:  ./install.sh --tools   (or GOPILOT_TOOLS=1 ./install.sh)"
  info "or grab the linux-amd64 tarball from https://github.com/jgm/pandoc/releases"
  exit 1
fi

info "rendering via pandoc → $OUT"
pandoc "$SRC" -o "$OUT"
[[ -s "$OUT" ]] || { err "pandoc produced no output"; exit 1; }
info "wrote $OUT"
