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

## Quickstart — plug and play

```bash
git clone https://github.com/christo0192/go-pilot.git && cd go-pilot
./install.sh                       # idempotent bootstrap (macOS/WSL); Windows: install.ps1
# → ensures Node + Docker, templates deploy/.env, fetches the Mem0 build context,
#   puts `pi-delegate` on PATH, registers the Pi workhorse provider, installs the
#   global orchestration skill

# then plug in YOUR key (the only required edit) in deploy/.env:
#   WORKHORSE_GATEWAY_KEY=...  # your workhorse-gateway key (Ikey, or any
#                              # OpenAI-compatible gateway — change LITELLM_BASE_URL too)

claude                             # in this repo — CLAUDE.md turns Claude Code into the
                                   # orchestrator: it routes subtasks to Kimi/DeepSeek worker
                                   # panes automatically and assembles verified results
```

**That's the daily driver.** Give `claude` a substantial task and watch `wk:deepseek` / `wk:kimi`
panes spawn, work, report back, and close. Optional extras:

```bash
# other keys in deploy/.env (all optional):
#   OPENAI_API_KEY=...       # Mem0's embedder (pure-anthropic has no embeddings API; ~free)
#   OPENROUTER_API_KEY=...   # activates the LOCAL LiteLLM workhorse — one key, every open model

docker compose -f deploy/docker-compose.yml up -d   # Mem0 memory (+ LiteLLM for local gateway)
node --test                                          # full suite must pass
node scripts/verify-litellm.mjs                      # probes each workhorse model (SKIP if no key)
```

The installer is **activate-by-key** (D31): a workhorse model is usable only if its provider
key is present; blank keys just leave that model inactive — one config serves every profile.
Frontier `claude`/`codex` use **native subscription login** and never touch `deploy/.env`.
Full details, idempotency, and uninstall: [`docs/INSTALL.md`](docs/INSTALL.md).

---

## How to run

| You want to… | Do this |
|---|---|
| Inspect a governed route without running a model | `npm run gopilot -- run --dry-run --category code "task"` |
| Run a governed live task | `npm run gopilot -- run --category code --cwd /path/to/repo "task"` |
| Run the Pi workhorse terminal (skills + extensions loaded) | `./scripts/pi-gopilot.sh` |
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
| **`pure-anthropic`** *(recommended start)* | Opus (claude) | Sonnet/Haiku subagents + Codex/GPT lateral | Claude Max + ChatGPT subs only — **no workhorse plane** |
| `hybrid` | Claude/Opus | open models via Pi/LiteLLM for cheap parallel fan-out | + Docker, OpenRouter (or vendor) key |
| `open-first` | GLM/Kimi | open models end-to-end | API keys only (most portable) |

`pure-anthropic` skips Sprint 2 entirely (no LiteLLM/open-model plane); its savings are
quota/rate-limit relief since everything is flat-rate. `GOPILOT_PROFILE` lives in `deploy/.env`.

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

Track everything in [`PLAN.md`](PLAN.md). Snapshot:

- **Live / proven:** herdr substrate + both frontier CLIs (claude, codex) + write-safety +
  worktree-per-pane (Sprint 1 ✅); router + context tiering incl. `rtk`/CCE (Sprint 3 ✅);
  two-tier memory with **real Mem0** (Sprint 4 ✅); Pi workflow skills (Sprint 5 ✅);
  installers + compose, `install.sh` live-verified idempotent (Sprint 6, 80%); metrics +
  acceptance harness (Sprint 7 ✅); governed runtime, live process adapters, retrieval,
  prompt/cache metadata, execution contracts, durable dispatch, retries, validation,
  observability, scoped rules, candidate racing, and workspace evidence.
- **Pending (needs a live provider key or a fresh machine):** the **live Pi workhorse worker**
  through LiteLLM + tool-call reliability *measurement* (Sprint 2 — gateway/config/repair are
  built and tested; the before/after numbers wait on `OPENROUTER_API_KEY`); **per-task-class
  live sign-off** against the #10 targets (D17 — rig ready, needs baseline runs); and the
  **fresh-machine Windows + Mac acceptance** (Step 6.5).

Frontier work was proven headlessly on WSL; the Wezterm GUI / visible-pane UX and Mac parity
are deferred to the Sprint 6 fresh-machine verify.
