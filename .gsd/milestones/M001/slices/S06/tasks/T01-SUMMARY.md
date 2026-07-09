---
task: S06/T01
title: install.sh (mac/WSL) idempotent bootstrap (Steps 6.1 + 6.4)
status: complete
duration: ~15min
files_changed: [install.sh, docs/INSTALL.md]
verification: bash_n_ok, shellcheck_clean, LIVE_idempotent_run_exit0
---
`install.sh` (repo root, +x): OS-detect (macos/wsl), idempotent `have`-guarded ensure of Node≥20 (NodeSource
on Ubuntu) + Docker(+compose) (apt docker.io + systemd on WSL — the D26 path; brew cask on mac), optional
`--full` rig (Herdr/Pi), non-destructive deploy/.env templating, blobless+sparse mem0-src clone (guarded),
`docker compose up -d`, verify (node --test + poll Mem0 /docs 200), READY report. Sourceable (BASH_SOURCE
guard) for testing.

VERIFIED LIVE: ran on this provisioned box → every step correctly skipped/no-op, node --test passed, Mem0
200, "✅ Go-pilot ready … No outstanding TODOs … Re-running is safe", exit 0. That IS Step 6.1's done-when
(second run = no-op). `bash -n` clean; shellcheck 0.11 zero findings. .env templating + guards unit-checked
in a temp dir. Left unrun (as intended): the sudo/apt/brew install lines (guarded, skip when tools present).
