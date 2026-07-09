# S01: Substrate + Frontier Plane

Profile: pure-anthropic (claude + codex already installed; no LiteLLM/Pi this slice).

## Tasks
- [x] **T01: Install Wezterm + Herdr** `est:done` ✅ 2026-07-09 — herdr 0.7.3 installed (user-run); headless server + socket API verified; orchestration loop (pane run → wait output → pane read) PROVEN. See panes/herdr-orchestration.md. (Wezterm GUI = install at Sprint 6 for the visible-pane UX; not needed for headless orchestration.)
  Depends on: S00
  Instructions: **User runs the installs** (auto-mode blocks remote-code execution — correct).
  - Herdr (WSL, no sudo, installs to ~/.local/bin):
    `curl -fsSL https://herdr.dev/install.sh | sh`  then ensure `~/.local/bin` on PATH.
  - Wezterm: Windows GUI app — installer already in Downloads (`WezTerm-*-setup.exe`), or https://wezterm.org.
  - Verify: `herdr --version`; start server, confirm detach/reattach.
  Done when: `herdr --version` works and a scripted socket call creates a workspace + reads it back.

- [x] **T02: Wrap official `claude` binary as frontier pane** `est:done` ✅ 2026-07-09 — lean claude worker dispatched into a herdr pane; boomerang wait + structured read proven (result='WORKER_OK', $0.0032, ~18× cheaper). No .claude modification. See T02-SUMMARY.md.
  Depends on: T01
  Instructions: spawn `claude` in a herdr pane via socket; native `/login`; prove read-screen + send from orchestrator. Orchestrator = full config; workers later run lean (D16).
  Done when: orchestrator tasks the claude pane and captures its reply via socket.

- [x] **T03: Wrap official `codex` binary as frontier pane** ✅ (result='CODEX_WORKER_OK'; lean-codex-worker.sh) `est:20min`
  Depends on: T01
  Instructions: same pattern for `codex` (separate ChatGPT login/quota).
  Done when: orchestrator tasks the codex pane and captures its reply.

- [x] **T04: write-safety — advisory lock (pane-lock.sh) + worktree isolation; claude-presence deferred** ✅ `est:30min`
  Depends on: T02
  Instructions: presence registry + advisory locks so two panes can't edit the same file.
  Done when: two panes on the same file are serialized by an advisory lock.

- [x] **T05: Git worktree-per-pane scaffolding** ✅ (herdr worktree verified) `est:30min`
  Depends on: T01
  Instructions: each executing pane gets its own worktree; planning pane owns merge-back.
  Done when: concurrent edits in separate worktrees merge back with no lost changes.

## Note
T01 is a user-run install. Once `herdr` is on PATH, I can resume T01 verification (socket
smoke test) and T02–T05 largely autonomously (T02/T03 need your one-time native /login).
