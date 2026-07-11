# Architectural Decisions (append-only)

## 2026-07-08 — Foundational (from brainstorm + research)
- D1: Terminal = Wezterm + Herdr (cross-platform). cmux rejected (macOS-only; builder on Windows/WSL).
- D2: Harness = Pi for open-model workers only. Official claude/codex binaries wrapped directly, NEVER via Pi/3rd-party OAuth (billing-as-extra-usage risk).
- D3: Access layer = LiteLLM self-hosted (Docker, local ≈ $0). Open models only; frontier uses native login.
- D4: Two planes joined by Herdr (frontier subscription / workhorse API). Orchestrator switchable per project.
- D5: Three model profiles — pure-anthropic (start), hybrid, open-first — as a config value; shared router/memory/tiering across all.
- D6: Memory = Tier-1 boomerang + shared store (ephemeral) + Tier-2 Mem0 (persistent), joined by a promotion filter. Fixes #1 friction (407 handovers). Letta/LLMLingua-2 deferred.
- D7: Context = Reference > Compressed > Full across pane boundaries; TOON for specs; rtk default output compression; CCE pilot-only with CCE→file→Compressed fallback; context-mode consolidation pilot.
- D8: Deterministic rule-based routing default; LLM judgment is the costed exception. Router overhead tracked as its own line item.
- D9: Validation gate BEFORE compression; git worktree per executing pane, merge-back owned by planner; chain-of-command escalation default (P2P exception only via agent-comms).
- D10: Numeric acceptance — ≥20% token reduction vs single-agent, ≤5% quality tolerance, tracked retry rates, router overhead separate.
- D11: Sprint 0 gates the project — concurrent-session safety + baseline-paradox pre-check before any router/harness code.

## 2026-07-08 — Execution
- D12: GSD milestone M001 tracks PLAN.md; PLAN.md remains the step-detail source of truth.
- D13: Sprint 0 spikes (T02–T04) are interactive/machine-specific — executed WITH the user (subscription login), not via autonomous subagent. Step 0.1 executed inline by main agent.

## 2026-07-08 — Sprint 0 findings
- D14: Concurrency GATE PASSED (provisional). 10 concurrent claude sessions spawned under one Max login — >> the ~4–5 panes pure-anthropic needs. Session-count is NOT a blocker. Residual: throughput-based rate-limits under heavy simultaneous generation — monitor; fallback = stagger/queue active generators if 429s appear.

- D15: Worker panes MUST run lean (minimal system prompt; skills+MCP disabled) to amortize the ~44k-token per-call Claude Code overhead (T03 finding). Fan-out is justified only when per-subtask real work >> fixed overhead OR workers use a much cheaper per-token model. Reframes Sprint 2/3 worker config + strengthens the case for lean Pi workers.

- D16: 44k overhead breakdown MEASURED — mostly the global ~/.claude/CLAUDE.md + user skills, then MCP schemas. LEAN WORKER config = `--setting-sources project --strict-mcp-config --mcp-config '{"mcpServers":{}}'` cuts ~60% cost/call. Baked into scripts/lean-worker.sh and baseline rig (workers default lean). Avoid --system-prompt (cache-busts). Obsidian *app* is in Program Files; actual vault ~ C:\Graphify X\obsidian (mine in Sprint 5 for workflow skills).

- D17: T04 (baseline-paradox per-class measurement) SKIPPED by user 2026-07-09. Mitigation: rig is built+ready; policy = each task class defaults to SINGLE-AGENT until validated with scripts/baseline-rig before relying on multi-pane for it. Preserves no-negative-return principle. Residual risk accepted given D14 (concurrency GO) + D16 (lean workers ~60% cheaper) priors.

- D18: Worker dispatch model FINALIZED = lean one-shot via `herdr pane run` (claude -p / codex exec) + `herdr wait output --match <result-token>` + `pane read` parse. No agent-integration hooks required (optional polish). Match only result-only tokens in wait (never command-echo substrings).
- D19: Write-safety = worktree-per-pane (herdr worktree) as primary isolation + pane-lock.sh (flock) for shared-checkout critical sections. claude-presence deferred until a real multi-session-same-repo need appears.

## 2026-07-09 — S03 Router
- D20: Router + all Sprint-3 orchestration code = **Node.js ESM, zero external deps**, tested with the
  built-in `node --test`. Rationale: python3 3.14 on this machine has no pip/ensurepip; Node v22 + npm work
  and are cross-platform (D1) and already a hard dep; zero-dep keeps the self-bootstrapping repo (S06) light.
  Router mapping is a **profile-keyed config** (`config/router.json`) so hybrid/open-first swap models with no
  code change (D5). Router stays pure/side-effect-free except the separate judgment-cost log (feeds Step 3.9).

## 2026-07-09 — S03 (continued)
- D21: Sprint-3 external-tool pilots (Step 3.4 rtk, 3.5 CCE, 3.6 context-mode) DEFERRED — tools not
  installed and installing them is an environment/user decision. Not blockers: the T03 boundary guard
  already provides the Reference/Compressed seam these would plug real compressors into; all degrade-safe (D7).
- D22: agent-comms mesh is EXCEPTION-ONLY. The `isExceptionAllowed` guard admits only
  `{type:"query", exception:true, from, to, ask}` (a peer FACT request); default work-routing is rejected
  so chain-of-command (#4/D9) remains the only default path. Fact-not-full-content ties it to the #1 invariant.

## 2026-07-09 — S04 Memory
- D23: S04 memory seams (store, gate, mem0-adapter, promotion, recall) built + tested against an in-memory
  MOCK Mem0 adapter under the pure-code scope chosen by the user. The mock and the future real Docker Mem0
  client implement one identical `{ add(memory), search(query, topK) }` contract — the only coupling point,
  so the real client is a drop-in (Step 4.3 deferred, not blocking). Two-tier pipeline: store(Tier-1) → gate →
  promotion(keepers only) → mem0-adapter(Tier-2) → recall(session-start). Directly targets #1 friction (407 handovers).

## 2026-07-09 — S04b Real Mem0 (Docker path)
- D24: User authorized the Docker→real-Mem0 path. Docker-independent prep built: `deploy/docker-compose.yml`
  (mem0/mem0-api-server + postgres/pgvector) + `src/memory/mem0-client.mjs` implementing the D23 {add,search}
  contract over the researched self-hosted REST API (`POST /memories`, `POST /search`), tested vs a node:http
  fake server (128/128). Live integration (S04b/T02) BLOCKED on (a) user installing Docker Desktop + WSL
  integration, and (b) choosing an EMBEDDING provider — Mem0 search needs embeddings even with infer:false, and
  pure-anthropic has none. Client tolerates v1.0/v1.1 response shapes; 7 assumptions logged to re-verify live.

## 2026-07-09 — S04b live integration findings
- D25: Real Mem0 self-host, corrected against ground truth (deploy/mem0-src/server, cloned 2026-07-09):
  (1) Prebuilt `mem0/mem0-api-server` is **arm64-only** (no amd64) → we BUILD FROM SOURCE (prod Dockerfile,
  context = sparse-cloned server/, git-ignored). (2) Our `src/memory/mem0-client.mjs` request/response shapes
  are VALIDATED against the real `main.py`: `POST /memories {messages,user_id,metadata,infer}`,
  `POST /search {query, user_id|filters, top_k}` → `{results:[...]}`; no `/v1/` prefix. (3) Server needs
  alembic migrations + an app DB + init-db.sh + a real EMBEDDER (OpenAI text-embedding-3-small default) — even
  with infer:false, since pure-anthropic has no embeddings. (4) `AUTH_DISABLED=true` opens the local single-node
  store (no JWT/api-key). Compose rewritten to build-from-source; deploy/.env holds the OpenAI key (git-ignored).
  Remaining to finish Step 4.3: user supplies OPENAI_API_KEY, then add/search round-trip via mem0-client.

## 2026-07-09 — S04b live integration COMPLETE (Step 4.3)
- D26: Real Mem0 is LIVE and end-to-end validated. Docker Engine installed natively in WSL2 (docker.io via apt
  + systemd, NO Windows restart — avoids losing the session). Built Mem0 from source (arm64-only prebuilt).
  Runtime fixes baked into deploy/docker-compose.yml: `pip install psycopg[binary]` at start (slim base lacks
  libpq) + `mem0_history` volume for HISTORY_DB_PATH. AUTH_DISABLED=true for the local single-node store.
  Live proof: `src/memory/mem0-client.mjs` + OpenAI text-embedding-3-small added 3 memories and semantic search
  ranked them correctly (router query→router memory 0.46; lunch query→lunch memory 0.48). The D23 mock→real
  swap is proven — promotion/recall accept any {add,search} adapter, so wiring mem0-client is a config swap.
  SECURITY: OpenAI key only in gitignored deploy/.env; it was pasted in chat → user advised to ROTATE it.

## 2026-07-09 — S06 Self-installing repo
- D27: Self-install = `install.sh` (mac/WSL) + `install.ps1` (Windows), both idempotent, repo root, `--full`/
  `-Full` gates the optional Herdr/Pi rig (pure-anthropic core needs neither). install.sh LIVE-verified as a
  no-op on the provisioned WSL box (Step 6.1 done-when met). 6.3 compose already satisfied by deploy/. Frontier
  uses native login (no keys); only open-model keys live in .env. Step 6.5 (fresh Win+Mac machine acceptance)
  deferred — needs clean boxes + a teammate; install.ps1's live run is part of that.

## 2026-07-09 — S04b Tier-2 wiring
- D28: `src/memory/tier2.mjs` `createTier2Adapter({mode})` selects mock vs real mem0-client (auto→real when a
  baseUrl is configured). `promote`/`recall` are now async and await adapter calls, so they work with BOTH the
  sync mock and the async real Mem0 client (await on a non-Promise is a no-op — mock behavior unchanged). Real
  Mem0 is the default Tier-2 when MEM0_BASE_URL is set; a live self-skipping integration test proves the full
  gate→promote→mem0→recall path (keeper retrieved, gated item excluded). Callers must await promote/recall.

## 2026-07-10 — S05 Pi workflow skills
- D29: Pi 0.80.6 installed (npm -g, user-writable prefix ~/.npm-global, NO sudo). Workflow authored as Pi SKILLS
  (dir + SKILL.md, project-discoverable under `.pi/skills/`) not prompt-templates — richer/model-invocable/chainable.
  6 skills: phase-0-align (5.2 gate: records alignment artifact, hard-blocks plan/auto until aligned), brainstorm,
  explore, plan, execute, auto (chains the rest). Verified via Pi RPC get_commands (all 6, project scope) + a
  gpt-4o-mini smoke (phase-0 asks the 4 alignment Qs before planning). Serves Pi-orchestrated profiles; pure-anthropic
  keeps Claude/GSD skills — identical workflow regardless of switched-in orchestrator (D5). Sprint 5 complete.

## 2026-07-10 — S03 context-tooling pilots (rtk/CCE)
- D30: rtk (rtk-ai/rtk, prebuilt musl binary, user-local) ADOPTED as the real "Compressed" tier backend —
  measured 81–99.6% output reduction on this repo (git log/--stat, node --test). CCE (elara-labs
  code-context-engine, `uv tool install code-context-engine[local]`, local bge embeddings) RETAINED as
  provisional Reference-tier retrieval (proven: router.mjs #1 hit). Verdict (docs/context-tooling-decision.md):
  KEEP BOTH — rtk=live command output, CCE=static code; orthogonal axes of the D7 ladder behind the boundary
  guard seam. Both degrade-safe: src/boundary/{rtk-compress,cce-retrieve}.mjs fall back (raw+truncate / file-path)
  and never throw; live tests self-skip when the tool is absent. Zero npm deps. Sprint 3 now fully complete.

## 2026-07-10 — SCOPE CORRECTION (user directive)
- D31: **Hybrid is a FIRST-CLASS goal, not a deferred option. Sprint 2 (workhorse plane) is IN scope.** The
  earlier "pure-anthropic, S02 skipped" (D5 framing / STATE) was a starting-profile shortcut and MISREAD the
  intent. Correct requirement: Go-pilot must be **profile-agnostic for broad adoption** — any user can run it
  anthropic-only, codex-only, or mixed/hybrid, and it must be eligible for all of them. Consequences:
  (1) Build Sprint 2: LiteLLM gateway (Docker) + Pi workhorse workers → open models + per-worker tool subsets +
  tool-call validate/repair Pi extension + constrained decoding. (2) This is ALSO the real fix for the per-worker
  ~44k Claude Code overhead the user asked about: Pi/open-model worker panes carry ZERO Claude Code harness — the
  frontier vs workhorse split (D2/D4) exists precisely for this. (3) All four profiles (pure-anthropic, codex-only,
  hybrid, open-first) become first-class in config/router.json + installers; activate providers by key presence in
  .env (no key → that model simply inactive), so one codebase serves every user preference. (4) LiteLLM needs ≥1
  open-model key; OpenRouter (one key → many models) is the recommended universal default for adoption.

## 2026-07-10 — Worker-spawn strategy (user insight) — reframes the 44k-overhead worry
- D32: The per-worker ~44k Claude Code overhead (D15/D16) is AVOIDED BY DESIGN in both target profiles, so it is
  NOT a blocker:
  • **anthropic-only** → spawn workers as Claude Code's **in-session subagents** (native Task/subagent feature):
    they run inside the SAME session and inherit the already-loaded context — they do NOT cold-start a separate
    `claude -p` process per pane, so the global CLAUDE.md / skills / MCP are NOT re-loaded per worker. (Subagents
    still cost tokens for their own work, but skip the per-pane config-reload tax.)
  • **hybrid / open-first** → workers are NON-anthropic (open models via LiteLLM/Pi), which carry NO Claude Code
    harness at all — zero CLAUDE.md tokens.
  ⇒ The separate lean-`claude -p`-per-pane model (D18) + its 44k tax that the baseline-rig measures is really only
  for cases needing TRUE OS-level pane/worktree isolation (e.g. parallel writes to one repo). For ordinary fan-out,
  prefer in-session subagents (anthropic) or open-model workers (hybrid). This substantially SHRINKS the
  baseline-paradox penalty (the multi-pane cost the D17 sign-off was worried about is largely a separate-process
  artifact, not intrinsic). Router/dispatch should pick the spawn mechanism BY PROFILE, not always spawn panes.

## 2026-07-10 — GPT production-readiness review adopted
- D33: The independent production-readiness review (docs/GPT-FINDINGS.md, 2026-07-10) is ACCEPTED — it's accurate
  and cross-validates our remaining work. Its central point is correct: we built the primitives but lack the
  single ENFORCED run path that composes them (+ representative evidence the whole system saves tokens). Added as
  PLAN.md **Sprint 8**, PHASED: Phase A (adoptable) = run coordinator + `gopilot run` (dry-run) + portable
  fake-provider e2e + weighted metrics accounting + test split + cheap reproducibility hardening + task-store state
  machine + token-aware boundary + finish live workhorse + per-class benchmark campaign — buildable now (8.8/8.9
  need the OpenRouter key + fixtures/quota). Phase B (production hardening: IPC auth, reliability/recovery,
  observability, prod secrets/pinning, cross-platform acceptance, pilot) = DEFERRED/tracked, calibrated for the
  hosted/shared-use bar rather than the current teammate-local goal. Calibration notes: the "172/172 not
  reproducible" was an env artifact (GPT's sandbox blocks localhost listeners → mesh/mem0 fake-server tests fail
  instead of skip) — 172/172 is real on WSL, but the split-portable-tests fix (8.3) is warranted. Next step = 8.1.

## 2026-07-11 — Workhorse gateway = Ikey (self-hosted LiteLLM), NOT OpenRouter
- D34: The user built "Ikey" — their OWN hosted LiteLLM gateway (VITE_GATEWAY_URL=https://ikey-gateway.fly.dev,
  BFF=https://ikey-bff.fly.dev) that issues ONE API key for ALL models with NO OpenRouter 5.5% markup. This is the
  workhorse provider for Go-pilot (supersedes the "OpenRouter recommended" framing in D31/S02). Consequence: Go-pilot
  points its workhorse directly at Ikey — set LITELLM_BASE_URL=https://ikey-gateway.fly.dev + the Ikey key as
  LITELLM_MASTER_KEY in deploy/.env; the LOCAL LiteLLM docker service becomes optional/offline-only (Ikey is the
  hosted LiteLLM). Router aliases in config/litellm.yaml + config/router.json must be reconciled to Ikey's actual
  model names (GET /v1/models on Ikey). "No amounts added" = an IKEY-SIDE credit/budget issue (upstream provider
  balance and/or the LiteLLM virtual-key budget), NOT a Go-pilot code fix — diagnose via verify-litellm.mjs error.

## D35 — Reliability layer complements the store (2026-07-11, S09/8.11)
The task-store (8.6) provides mutual exclusion (who runs a task); the journal
(`src/reliability/journal.mjs`) provides exactly-once + recovery ON TOP of it.
dispatchOnce uses AT-LEAST-ONCE semantics: a crash in the narrow window between
fn() succeeding and the `done` record persisting re-runs fn on recovery. That's
acceptable because (a) reconcile() guarantees no LOST work and (b) the store's
claim+result layer dedups at the task level. Do NOT try to make the journal
alone exactly-once across a crash — that needs a 2-phase commit we deliberately
avoid at zero-dep. Retry/backoff/breaker keep clock+rng+sleep INJECTABLE so
tests stay hermetic (no real timers).

## D36 — Observability redaction is KEY-based (2026-07-11, S09/8.12)
`redact()` in `src/observability/events.mjs` matches sensitive KEY names by
word-part (so `token` is redacted but the `tokens` metric survives). It does NOT
scan free-text VALUES. Consequence: callers MUST place secrets in clearly-named
fields, never inside a free-text `note`/`message` value, or they will not be
redacted. Chosen over value-scanning to avoid false positives + cost on every
event. Config trust is separately enforced by `config doctor` (8.13).
