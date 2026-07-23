# Go-pilot

A token-efficient, multi-agent **terminal-orchestration rig**. A switchable orchestrator
assigns work by task category to worker models across **two planes**, with persistent
cross-session memory so you never hand-write a context handover again.

Go-pilot is **profile-agnostic** — the architecture is identical whether you run it
`pure-anthropic` (Claude/Codex only), `hybrid` (Claude judgment + cheap open-model
fan-out), or `open-first` (open models end-to-end). Only *which model fills which tier*
changes; it's a config value.

Zero npm runtime dependencies: the harness is plain **Node.js ESM**. Tests are split into
portable unit, loopback integration, and external live suites. Mem0 and local LiteLLM are
optional Docker services.

> **Source of truth:** [`PLAN.md`](PLAN.md) tracks the full sprint-by-sprint build and
> live status. This README is the onboarding front door.

---

## What it is (one paragraph)

Two planes joined by **[Herdr](panes/herdr-orchestration.md)** (a headless, socket-driven
terminal-pane orchestrator). The **frontier plane** runs the official `claude` and `codex`
binaries on *your* subscription login — high-stakes judgment, spawned as in-session
subagents so they carry no per-pane config-reload tax (decision **D32**). The **workhorse
plane** runs bulk/background work on cheap open models via **Pi → LiteLLM → Kimi/GLM/DeepSeek/
Qwen/MiniMax**, carrying **zero Claude Code overhead**. A deterministic **router**
(`config/router.json`) maps each task category to a `{plane, model}`; **context tiering**
(Reference > Compressed > Full, plus `rtk`/CCE output compression and TOON task-specs) keeps
tokens small across every pane boundary. **Two-tier memory** — a file-locked Tier-1 working
store with a validation gate + promotion filter, feeding a real **Mem0** Tier-2 for
persistent, cross-session, semantic recall — replaces the manual handover ritual. An
acceptance harness measures the whole thing against numeric targets (#10: ≥20% token
reduction, ≤5% quality tolerance, tracked retries, router overhead as its own line item).

---

## Quickstart — one-click (recommended)

**Windows (WSL):** download [`setup.cmd`](https://raw.githubusercontent.com/christo0192/go-pilot/main/setup.cmd)
and **double-click it**. It asks for one hidden key paste, then provisions a dedicated Ubuntu
distribution and Linux user, installs Node 22, Docker, herdr, Pi, Claude Code, and Codex CLI,
clones the repo to `~/Go-pilot`, validates the required components, installs a **Go-pilot app with
an icon and Start menu entry**, and opens Herdr. If Windows
needs a restart while enabling WSL, setup registers a one-time resume after sign-in. Approve the
Windows administrator prompt and any restart confirmation; no Linux commands or password are
required. Existing non-Ubuntu WSL distributions are never modified.

**macOS:** download [`setup-macos.command`](https://raw.githubusercontent.com/christo0192/go-pilot/main/setup-macos.command)
and double-click it in Finder (first run: `xattr -d com.apple.quarantine setup-macos.command`
if Gatekeeper objects, or right-click → Open). Same flow; the window it opens becomes the herdr
terminal. Homebrew's installer may ask for your macOS password once. Both installers put
`claude` and `codex` on PATH; run each once inside herdr to complete its native subscription
login. Go-pilot never requests or stores those account credentials.

### Installed app, resume, voice, and updates (Windows)

- Open **Go-pilot** from Start. Herdr runs as the named, headless `gopilot` server; the visible
  terminal is only a client. Closing it leaves Herdr and Pi running, and reopening attaches to the
  same panes and in-flight process. After a WSL/server restart, Herdr restores the workspace and Pi
  continues its latest saved Go-pilot conversation.
- Open **Go-pilot Voice** once to install the pinned local `whisper.cpp` engine and quantized English
  model. Press **F8** to start listening and F8 again to stop. Finished phrases paste into an
  allowlisted terminal; Go-pilot never presses Enter for you. Audio stays on the machine.
- New one-click installs use the **nightly** channel: every `main` commit becomes eligible only after
  its matching GitHub Actions CI run succeeds. Use **Update Go-pilot** for a manual check and
  **Rollback Go-pilot** to return to the prior installed commit.
- To switch to deliberate tagged releases, run this once in PowerShell:
  `powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\Programs\Go-pilot\GoPilot.ps1" -Action Update -Channel stable`.
- Setup installs pinned Pi and Herdr builds from their official repositories, runs Herdr's official
  `pi`, `claude`, and `codex` integration installers, and installs Herdr's checksum-locked command
  skill for all three agents. Go-pilot's Pi workflow skills and tool-call repair extension are also
  registered globally without replacing existing Pi settings. Agents can therefore discover panes,
  split them, launch another agent, send a task, wait, and read results without researching syntax.

Re-running `setup.cmd` upgrades an existing installation and refreshes its shortcuts. When a valid
workhorse key already exists, press Enter at the key prompt to keep it.

<details><summary><b>Manual install (the old way)</b></summary>

```bash
git clone https://github.com/christo0192/go-pilot.git && cd go-pilot
./install.sh --full                # idempotent bootstrap (macOS/WSL); Windows: install.ps1
# → ensures Node + Docker, herdr + Pi (--full), templates deploy/.env, fetches the
#   Mem0 build context, installs official Herdr integrations/skill, registers Pi resources

# then plug in YOUR key (the only required edit) in deploy/.env:
#   WORKHORSE_GATEWAY_KEY=...  # your workhorse-gateway key (Ikey, or any
#                              # OpenAI-compatible gateway — change LITELLM_BASE_URL too)

claude                             # in this repo — CLAUDE.md turns Claude Code into the
                                   # orchestrator: it routes subtasks to Kimi/DeepSeek worker
                                   # panes automatically and assembles verified results
```
</details>

**That's the daily driver.** Give `claude` a substantial task and watch `wk:deepseek` / `wk:kimi25`
panes spawn, work, report back, and close. Optional extras:

```bash
# other keys in deploy/.env (all optional):
#   OPENAI_API_KEY=...       # Mem0's embedder (pure-anthropic has no embeddings API; ~free)
# Re-run setup after adding the key: it starts/upgrades Mem0 and connects gopilot
# through MEM0_BASE_URL. MEM0_MIN_SCORE=0.3 controls the recall relevance floor.
#   OPENROUTER_API_KEY=...   # activates the LOCAL LiteLLM workhorse — one key, every open model

docker compose -f deploy/docker-compose.yml up -d   # Mem0 memory (+ LiteLLM for local gateway)
node --test                                          # full suite must pass
node scripts/verify-litellm.mjs                      # probes each workhorse model (SKIP if no key)
```

The installer is **activate-by-key** (D31): a workhorse model is usable only if its provider
key is present; blank keys just leave that model inactive — one config serves every profile.
Frontier `claude`/`codex` use **native subscription login** and never touch `deploy/.env`.
Mem0 is deliberately optional in the one-key setup: it remains disabled until
`OPENAI_API_KEY` (or a separately configured compatible embedder) is supplied.
Full details, idempotency, and uninstall: [`docs/INSTALL.md`](docs/INSTALL.md).

---

## How to run

| You want to… | Do this |
|---|---|
| Inspect a governed route without running a model | `npm run gopilot -- run --dry-run --category code "task"` |
| Run a governed live task (recall + auto-promotion when Mem0 is enabled) | `npm run gopilot -- run --category code --cwd /path/to/repo "task"` |
| Run without writing memory | `npm run gopilot -- run --no-remember --category code "task"` |
| Launch an interactive Pi workhorse agent (skills + extensions loaded) | `./scripts/pi-ikey.sh` |
| Orchestrate panes (frontier + workhorse) | `herdr server` then `herdr` — see [`panes/herdr-orchestration.md`](panes/herdr-orchestration.md) |
| Dispatch a lean frontier worker | `scripts/lean-worker.sh` (claude) · `scripts/lean-codex-worker.sh` (codex) |
| Run portable tests | `npm run test:unit` |
| Run loopback integration tests | `npm run test:integration` |
| Run dependency-backed tests | `npm run test:live` |
| Verify the workhorse gateway | `node scripts/verify-litellm.mjs` |

`gopilot run` is the supported policy-enforcing path. It resolves the execution contract,
route, model, tool profile, scoped rules, retrieval budget, prompt budget, journal, retry and
circuit-breaker policy, validation contract, memory promotion, usage record, event trace, and
workspace diff. Herdr remains the pane substrate for interactive and parallel workflows.

---

## Model profiles (pick per project)

| Profile | Orchestrator | Workers | Needs |
|---|---|---|---|
| **`pure-anthropic`** *(subscription-only option)* | Opus (claude) | Sonnet/Haiku subagents + Codex/GPT lateral | Claude Max + ChatGPT subs only — **no workhorse plane** |
| `hybrid` | Claude/Opus | open models via Pi/LiteLLM for cheap parallel fan-out | + Docker, OpenRouter (or vendor) key |
| `open-first` | GLM/Kimi | open models end-to-end | API keys only (most portable) |
| **`ikey-prod`** *(production policy)* | Opus | DeepSeek default; Kimi K2.5 extraction/doc-QA | Workhorse gateway key |

The default profile is declared in `config/runtime.json`; CLI `--profile` and `GOPILOT_PROFILE`
override it. The generated active routing table is [`docs/production-routing.md`](docs/production-routing.md).
The replicated quality, token, cost, reliability, and latency evidence is
[`docs/production-metrics.md`](docs/production-metrics.md).

---

## Repo map

```
PLAN.md              # source-of-truth build plan (8 sprints) + live status
README.md            # this file — teammate onboarding
src/                 # the harness (zero-dep Node ESM, node --test)
  router/            #   deterministic task-category → {plane, model} + tool-profile selection
  toon/              #   TOON task-spec serialization (fewer tokens than JSON)
  boundary/          #   Reference > Compressed > Full boundary enforcement (#1 invariant)
  prompts/           #   worker system-prompt fragments (Ponytail YAGNI, etc.)
  comms/             #   agent-comms P2P mesh (lateral/exception routing only)
  memory/            #   Tier-1 store + validation gate + promotion filter (Mem0 adapter)
  metrics/           #   per-run metrics + #10 acceptance report
  toolcall/          #   open-model tool-call validator + repair loop
deploy/              # docker-compose (Mem0 + LiteLLM), litellm.yaml, .env(.example)
.pi/                 # Pi worker surface
  skills/            #   brainstorm → explore → plan → execute → auto + phase-0 alignment gate
  extensions/        #   tool-call-repair.ts (Pi wrapper over src/toolcall)
config/              # router.json, tool-profiles.json, toolcall-schemas.json, prompts/
scripts/             # install-time + rig scripts (pi-gopilot, lean workers, baseline-rig)
panes/               # herdr pane/workspace layout + orchestration reference
docs/                # INSTALL, environments, concurrency + task-class + context-tooling reports
metrics/             # quality rubric + run metrics
.gsd/                # GSD autonomous-execution state (M001 tracks PLAN.md) + DECISIONS.md
research docs/       # BRD, model-strategy docs, sources & decisions
```

---

## Status

**Released: [`v1.0.0`](CHANGELOG.md)** — the production orchestration rig, hardened and measured.
Sprint history in [`PLAN.md`](PLAN.md); decisions in [`.gsd/DECISIONS.md`](.gsd/DECISIONS.md). Snapshot:

- **Live / proven:** herdr substrate + both frontier CLIs (claude, codex) + worktree-per-pane;
  deterministic router + context tiering; two-tier memory with **real Mem0**; Pi workflow skills;
  the governed runtime (contracts, durable dispatch, retries, validation, observability, scoped
  rules, candidate racing, workspace evidence). The **live coordinator workhorse path** is proven
  end-to-end — `gopilot run` dispatches through a real Pi agent → Ikey gateway → DeepSeek/Kimi and
  reports recovered token usage + calibrated cost. **Clean-machine install is CI-verified on
  ubuntu, macOS, and Windows** (`install.sh --doctor` / `install.ps1 -Doctor`).
- **Benchmark-driven routing (`ikey-prod`):** DeepSeek V4 Pro is the default workhorse; **Kimi
  K2.5** handles document-QA (3-trial confirmed, 97.1) and extraction (schema-validated, ≥90 in
  the production-gate run) with a DeepSeek fallback. Kimi K2.6 was retired (K2.5 strictly
  dominates it); Kimi K3 was evaluated and rejected (~$15/M). Evidence:
  [`docs/production-metrics.md`](docs/production-metrics.md) + `docs/live-test-results-v3-*.md`.
- **Assessed / safe-by-default:** multi-agent efficiency sign-off (D17/D39) reverts every class to
  single-agent — the framework's multi-pane modes are reliability-oriented, not token-reducing, so
  the gate correctly reverts ([`docs/multi-agent-signoff-status.md`](docs/multi-agent-signoff-status.md)).

Honest scope: the model-quality evidence is directional (frozen fixture samples, not a many-repo
soak). The local LiteLLM workhorse path (`open-first` via OpenRouter) remains an untested option
alongside the proven Ikey gateway path.
