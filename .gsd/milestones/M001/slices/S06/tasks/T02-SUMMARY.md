---
task: S06/T02
title: install.ps1 (Windows) idempotent bootstrap (Step 6.2)
status: authored (Windows verify deferred to Step 6.5)
duration: ~12min
files_changed: [install.ps1, docs/INSTALL.md]
verification: structural_parity_review, brace_paren_balanced; pwsh_absent_here
---
`install.ps1` (repo root): PowerShell 5.1+/7 parity of install.sh — env detect, Node LTS + Docker Desktop via
winget (choco fallback; manual URLs if neither), `-Full` rig switch, non-destructive deploy/.env templating,
guarded mem0-src sparse clone, `docker compose up -d`, verify (node --test + 120s /docs poll), READY report.
Idempotent via Test-Command/Test-Path guards; paths anchored to $PSScriptRoot. Concurrent-write on
docs/INSTALL.md coordinated cleanly (final file has macOS/WSL + Windows + Revert sections).

Cannot execute here (no pwsh in WSL bash) — brace/paren balance verified (75/75, 118/118), PS 5.1-vs-7 compat
reviewed ($IsWindows fallback, $LASTEXITCODE checks, UTF-8 console). LIVE Windows run is the deferred Step 6.5
fresh-machine verification (needs a Windows box) — the "teammate can use it" acceptance.
