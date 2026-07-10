#!/usr/bin/env bash
#
# md2pdf.sh — turn a Markdown file into a PDF (zero-dep bash helper).
#
# Usage:
#   md2pdf.sh <file.md> [out.pdf]
#
# Strategy (first path that works wins):
#   1. pandoc --pdf-engine=weasyprint  → a true, self-contained PDF (best).
#   2. pandoc md→html                  → then print the HTML from a browser
#                                        (Ctrl+P → "Save as PDF"). Emits the
#                                        HTML and clear instructions.
#   3. no pandoc                        → a clear, actionable error.
#
# Install the toolchain with:  ./install.sh --tools   (or GOPILOT_TOOLS=1)
# See docs/trader-workflow.md for the full doc pipeline.

set -euo pipefail

have() { command -v "$1" >/dev/null 2>&1; }
err()  { printf '\033[1;31mmd2pdf: %s\033[0m\n' "$*" >&2; }
info() { printf '    %s\n' "$*" >&2; }

# --- args -------------------------------------------------------------------
if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'
  exit "$([[ $# -lt 1 ]] && echo 2 || echo 0)"
fi

SRC="$1"
[[ -f "$SRC" ]] || { err "no such file: $SRC"; exit 2; }

# Default output: same basename, .pdf extension, in the same directory.
OUT="${2:-${SRC%.*}.pdf}"

# --- path 1: pandoc + weasyprint (true PDF) ---------------------------------
if have pandoc && have weasyprint; then
  info "rendering via pandoc + weasyprint → $OUT"
  # weasyprint prints harmless CSS warnings to stderr; keep them out of the way
  # but don't hide a real failure.
  if pandoc "$SRC" --pdf-engine=weasyprint -o "$OUT" 2> >(grep -vi 'warning' >&2 || true); then
    [[ -s "$OUT" ]] && { info "wrote $OUT"; exit 0; }
  fi
  err "weasyprint render failed — falling back to the HTML/browser path below."
fi

# --- path 2: pandoc md→html, print from a browser ---------------------------
if have pandoc; then
  HTML="${OUT%.pdf}.html"
  info "weasyprint not available — writing HTML instead: $HTML"
  pandoc "$SRC" --standalone --embed-resources -o "$HTML"
  cat >&2 <<EOF

    md2pdf: produced an HTML file (no PDF engine on PATH).
    To get a PDF, open it in a browser and print to PDF:

        Windows : start msedge "$HTML"      # or: start chrome "$HTML"
        WSL      : explorer.exe "$HTML"
        then     : Ctrl+P → "Save as PDF"

    Or install weasyprint for a one-shot true PDF:
        uv tool install weasyprint    # then re-run this script
    Or emit a Word doc instead (native, no engine needed):
        scripts/md2docx.sh "$SRC"
EOF
  # HTML was produced successfully; signal "partial" so callers can react.
  exit 3
fi

# --- path 3: nothing available ----------------------------------------------
err "pandoc is not installed — cannot convert Markdown."
info "install it with:  ./install.sh --tools   (or GOPILOT_TOOLS=1 ./install.sh)"
info "or grab the linux-amd64 tarball from https://github.com/jgm/pandoc/releases"
exit 1
