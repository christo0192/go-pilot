# Installing Go-pilot

Go-pilot is a zero-dependency Node.js (ESM) rig. The bootstrap scripts are
**idempotent** — re-running them makes no destructive changes. They ensure
Node + Docker are present, template `deploy/.env`, fetch the Mem0 build
context, bring up the self-hosted Mem0 (Tier-2 memory) stack, and verify.

Prerequisites the scripts will install if missing: **Node LTS** and **Docker**.
`git` is required to fetch the Mem0 build context.

After install, edit `deploy/.env` and set **`OPENAI_API_KEY`** — Mem0 needs an
embedder even though the client sends `infer:false`, and pure-anthropic has no
embeddings API (`text-embedding-3-small` is ~free).

---

## macOS / WSL (install.sh)

```bash
./install.sh            # idempotent bootstrap
./install.sh --full     # also install the optional full rig (pi-coding-agent etc.)
./install.sh --tools    # also install the trader doc-toolkit (user-local, no sudo)
```

### `--tools` — trader doc-toolkit + aesthetic (opt-in)

`--tools` (or `GOPILOT_TOOLS=1`) installs a terminal document toolkit entirely
under `~/.local/bin` — **no sudo, no system packages**:

| Tool | Purpose |
|---|---|
| **yazi** | file manager + previews (the in-terminal "sidebar") |
| **glow** | render Markdown in the terminal |
| **visidata** (`vd`) | explore CSV / XLSX / JSON |
| **pandoc** | convert Markdown → docx / html / pdf |
| **weasyprint** | PDF engine for `pandoc` (true md→PDF) |

Plus two zero-dep wrappers: `scripts/md2pdf.sh` (pandoc + weasyprint, with an
HTML/browser-print fallback) and `scripts/md2docx.sh` (native pandoc, always
works). The full workflow — VSCode Remote-WSL, Herdr in the integrated
terminal, recommended trader extensions, and the Windows Terminal look — is in
[`trader-workflow.md`](trader-workflow.md).

The **aesthetic Herdr theme** (`config/herdr-config.toml` — Catppuccin, auto
light/dark, mauve `#cba6f7` accent) is installed to `~/.config/herdr/config.toml`
on **every** run, but **only if you don't already have one** (it never clobbers).
Add `~/.local/bin` (and `~/.npm-global/bin`) to your `PATH` so the toolkit is
callable.

What it does:

1. Detects the OS and package manager (Homebrew on macOS, apt on WSL/Debian).
2. Installs Node LTS and Docker if missing (or prints manual download URLs).
3. With `--full`, installs pinned official Pi and Herdr versions, then runs Herdr's official
   integrations for `pi`, `claude`, and `codex`. It downloads the official Herdr `SKILL.md` from
   the locked release in `deploy/herdr-skill.lock.json`, verifies its SHA-256, and installs it for
   every agent. Existing Pi settings are merged, never replaced.
4. Creates `deploy/.env` when absent. On upgrades, adds newly introduced keys
   without changing existing values or secrets. When `OPENAI_API_KEY` is set,
   it also enables the installer-managed `MEM0_BASE_URL`.
5. Sparse-clones the Mem0 server into `deploy/mem0-src` (blobless, depth 1):
   ```bash
   git clone --filter=blob:none --no-checkout --depth 1 \
     https://github.com/mem0ai/mem0.git deploy/mem0-src
   cd deploy/mem0-src && git sparse-checkout set server && git checkout && cd -
   ```
6. `docker compose -f deploy/docker-compose.yml up -d --build --remove-orphans`;
   named memory volumes are preserved while stale containers are upgraded.
7. Runs `node --test` and polls `http://127.0.0.1:8888/docs` for HTTP 200.
8. Prints a **✅ Go-pilot ready** report (OS, node/docker versions, Mem0 URL, TODOs).

### Preloaded Herdr pane commands

The full install puts the official Herdr command skill in Pi, Claude, and Codex. Agents first check
`HERDR_ENV=1`, refresh the current compact IDs, and then use patterns such as:

```bash
herdr pane list
NEW_PANE=$(herdr pane split 1-2 --direction right --no-focus | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW_PANE" "claude"
herdr wait output "$NEW_PANE" --match ">" --timeout 15000
herdr pane run "$NEW_PANE" "review the test coverage in src/api/"
herdr wait agent-status "$NEW_PANE" --status done --timeout 60000
herdr pane read "$NEW_PANE" --source recent-unwrapped --lines 80
```

Herdr pane IDs can compact after panes close, so agents are instructed to re-run `herdr pane list`
instead of retaining guessed IDs. Verify or repair the direct integrations with:

```bash
herdr integration status
herdr integration install pi
herdr integration install claude
herdr integration install codex
```

> Note: on WSL, Docker is typically provided by Docker Desktop's WSL2
> integration. Ensure Docker Desktop is running before you invoke the script.

---

## Windows (install.ps1)

Run from an **elevated PowerShell** if Node or Docker still need installing
(package installs require admin). If both are already present, a normal shell
is fine.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Optional full rig (global npm agents such as `@earendil-works/pi-coding-agent`):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Full
```

Optional trader doc-toolkit + aesthetic (`-Tools`): installs yazi / glow /
pandoc via winget/scoop and visidata / weasyprint via uv where available
(anything that can't auto-install is reported as a manual step), then copies the
aesthetic Herdr theme into your **WSL** home (`~/.config/herdr/config.toml`, only
if absent — Herdr runs under WSL). See [`trader-workflow.md`](trader-workflow.md).

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools
```

> **md→PDF on Windows:** weasyprint needs the GTK3 runtime for true PDFs. If it
> isn't present, use `pandoc file.md -o file.docx` (native) or `pandoc file.md -s
> -o file.html` then Ctrl+P → Save as PDF in the browser.

What it does:

1. **Environment detection** — confirms Windows; reports whether `winget`
   (preferred) or `choco` is available, and whether `docker` is already on PATH
   (Docker Desktop / WSL2-integrated Docker Desktop).
2. **Node LTS** — `winget install OpenJS.NodeJS.LTS` (or `choco install nodejs-lts`),
   guarded by `Get-Command node`. If neither package manager exists it prints
   <https://nodejs.org/en/download> and exits with guidance.
3. **Docker Desktop** — `winget install Docker.DockerDesktop` (or
   `choco install docker-desktop`), guarded. Docker Desktop may require a Docker
   sign-in and a **Windows restart** before the CLI works; the script says so and
   asks you to re-run once Docker is running.
4. **Config** — copies `deploy\.env.example` → `deploy\.env` only if absent;
   otherwise leaves your file untouched.
5. **Mem0 build context** — sparse-clones `deploy\mem0-src` (guarded; skipped if
   it already exists).
6. **Bring up** — `docker compose -f deploy\docker-compose.yml up -d`.
7. **Verify** — runs `node --test`, polls `http://localhost:8888/docs` for HTTP
   200 (up to ~120s), and on failure dumps `docker compose ... logs mem0`. Prints
   a **✅ Go-pilot ready** summary with OS, `node -v`, `docker --version`, the
   Mem0 URL, and any TODOs (e.g. "Set OPENAI_API_KEY in deploy/.env").

**Idempotency:** a second run is a safe no-op — existing `deploy\.env`,
`deploy\mem0-src`, Docker volumes, and running containers are all left in place.

### One-click Windows application lifecycle

The downloadable `setup.cmd` additionally installs a per-user application shell under
`%LOCALAPPDATA%\Programs\Go-pilot`, Start menu shortcuts, an Installed Apps uninstall entry, and the
Go-pilot icon. Ordinary application close detaches from the named Herdr session; it never invokes
`herdr session stop`. Use the Start menu Doctor, Update, Rollback, Voice, and Uninstall entries for
explicit lifecycle actions.

Fresh installs and updates also install a checksum-pinned
`JetBrainsMonoNL NFM` face for the current Windows user. Nerd Fonts v3 shortened
the old `JetBrainsMono NL Nerd Font Mono` family name; the installer backs up
Windows Terminal settings and migrates only that exact obsolete reference.
Re-running setup or **Update Go-pilot** repairs a missing or stale font without
requiring a machine-wide font install.

The optional local voice model is downloaded only when **Go-pilot Voice** is first opened. The
`whisper.cpp` executable and model are both SHA-256 verified. Uninstall removes the Windows launcher
and voice model but deliberately preserves WSL configuration, conversations, and Docker data.

Full design, acceptance cases, scoring, and limitations: [`desktop-app-plan.md`](desktop-app-plan.md).

> **`OPENAI_API_KEY`:** after the first run, open `deploy\.env` and fill
> `OPENAI_API_KEY=` so Mem0's embedder can serve `/search`. The stack starts
> without it, but memory search will not work until it is set.

---

## Revert / uninstall

```bash
docker compose -f deploy/docker-compose.yml down -v   # stop services + drop Mem0/pg volumes
rm -f deploy/.env                                      # remove local config (keeps .env.example)
rm -rf deploy/mem0-src                                 # remove the sparse build context
```

System packages installed by the script (Node, Docker) are left in place — remove
them with `brew uninstall …` (macOS) or `sudo apt-get remove …` (WSL/Ubuntu) if desired.

> **WSL note:** `install.sh` installs the native Docker engine via `apt`
> (`docker.io` + `docker-compose-v2`) and adds you to the `docker` group — open a
> **new shell** afterward. If you instead use Docker Desktop's WSL2 integration,
> the engine is already present and the script simply detects and skips it.
