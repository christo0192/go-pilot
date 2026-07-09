# S06: Cross-Platform Self-Installing Repo — SCOPED (pure-anthropic)

Scoped to what's buildable now. 6.3 (compose) is already satisfied by the proven `deploy/docker-compose.yml`
(Mem0+pgvector; LiteLLM skipped in pure-anthropic per D3). 6.5 (fresh-machine Win+Mac verify) is DEFERRED —
needs a clean box/VM + a teammate (acceptance step). Frontier uses native claude/codex login — no keys.

## Tasks
- [ ] **T01: install.sh (mac/WSL) idempotent bootstrap** (Step 6.1 + 6.4) `est:30min`
  Detect OS (macOS / WSL-Ubuntu); ensure Node + Docker(+compose) present, install if missing via the right
  pkg mgr (brew on mac; apt docker.io + systemd on WSL — the path proven this session, D26); render deploy/.env
  from deploy/.env.example if absent (never overwrite); `docker compose -f deploy/docker-compose.yml up -d`;
  verify (node --test + curl Mem0 /docs 200); print a READY report. Re-run = no-op (idempotent guards).
  Herdr/Pi install = optional block (full rig), gated behind a flag. Author + validate: `bash -n`, shellcheck
  if available, and test the idempotent GUARDS + .env templating WITHOUT running system-mutating apt/brew.

- [ ] **T02: install.ps1 (Windows) idempotent bootstrap** (Step 6.2) `est:25min`
  PowerShell parity of T01: detect Windows; check Node + Docker Desktop (or WSL docker); winget/choco install
  if missing; render deploy/.env; docker compose up; verify; READY report; re-run no-op. Cannot execute here
  (no pwsh in this WSL bash) — author carefully mirroring T01; syntax-check if pwsh present, else structural review.

## Already satisfied / deferred
- 6.3 compose — DONE (deploy/docker-compose.yml, live-verified this session). LiteLLM optional (hybrid/open-first only).
- 6.4 secrets/templating — folded into T01/T02 (.env from .env.example; frontier native login; open-model keys only).
- 6.5 fresh-machine Win+Mac verification — DEFERRED (needs clean machine + teammate; the acceptance gate).

## Outcome (2026-07-09)
- [x] T01 install.sh — DONE + LIVE-verified idempotent no-op on WSL (exit 0, Mem0 200). Steps 6.1 + 6.4.
- [x] T02 install.ps1 — AUTHORED with parity; live Windows verify = deferred Step 6.5.
- 6.3 compose ✅ (deploy/docker-compose.yml, live). docs/INSTALL.md covers both OSes + revert.
- Sprint 6 ~80%: only 6.5 fresh-machine Win+Mac acceptance remains (needs clean boxes / teammate).
