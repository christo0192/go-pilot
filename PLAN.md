# Go-pilot — Implementation Plan (Source of Truth)

**Overall Progress:** `M001 core ~92%` + `Sprint 8 (Production Readiness) 0%`  ·  *(S00–S07 build done, 174/174 tests. Sprint 8 folds in the GPT-FINDINGS production review, phased: Phase A adoptable — run coordinator + measurement + cheap hardening — buildable now; Phase B production hardening deferred. See docs/GPT-FINDINGS.md + D33.)*

> **How to use this file.** This is the single authoritative build plan. Build **sprint
> by sprint, top to bottom**. Do not start a step until its `Depends on` steps are Done.
> **Sprint 0 is a hard gate** — no router/harness code ships until its go/no-go passes.
> Tick `[ ]` → `[x]` as steps complete and update **Overall Progress** + each sprint's
> progress line. Spec authority = the 14 decisions in
> `research docs/research-sources-and-decisions.pdf` + the 3 model-strategy docs + the
> finalized session decisions. There is no separate Technical Documentation; this file is it.

---

## TLDR

A cross-platform (macOS + Windows), token-efficient multi-agent terminal rig on **Wezterm
+ Herdr**: a switchable orchestrator assigns work by task category to cheap open-model
**Pi workers (via LiteLLM)**, while **official `claude`/`codex` binaries** handle
high-stakes judgment. Ships as a private repo that self-bootstraps on a teammate's machine.

## Critical Decisions

- **Two planes, joined by Herdr:** frontier = official `claude`/`codex` binaries
  (subscription login); workhorse = Pi → LiteLLM → Kimi/GLM/DeepSeek/MiniMax (API). —
  isolates metered token spend from flat-rate subscription work.
- **Never route `claude`/`codex` through Pi / 3rd-party OAuth** — billing-as-extra-usage
  risk (decision #14). Wrap the official binaries directly.
- **Switchable everything:** orchestrator + every worker model is a config value
  (Pi `/model` + LiteLLM). Orchestrator plane is switchable **per project**.
- **Deterministic routing by default**; LLM judgment is the costed exception (#9).
- **Reference > Compressed > Full** for all cross-pane content (#1); **TOON** for specs.
- **Mem0 = Core** (persistent Tier-2 memory) — fixes the #1 measured friction (407
  handovers). Boomerang + shared store = Tier-1 working memory.
- **Validate before building:** concurrent-session safety + the baseline-paradox
  pre-check gate the whole project (#11, #12).
- **Numeric acceptance (#10):** ≥20% token reduction vs single-agent baseline, ≤5%
  quality tolerance, tracked retry rates, router overhead as its own line item.
- **Hosting ≈ $0:** LiteLLM + Mem0 run locally via Docker Compose.

### Model Profiles (choose per project — the architecture is identical)

The rig runs any of these by config; only *which models fill which tier* changes.

- **`pure-anthropic`** — Opus orchestrates; Sonnet workers; Haiku high-volume; Codex/GPT
  lateral. **All official binaries, no workhorse-API plane** → Sprint 2 (LiteLLM + open
  models + tool-call-repair) is **skipped**. Highest quality; token savings are
  quota/rate-limit relief only (all flat-rate). Viability gated on Max concurrent-session
  limits (Sprint 0, Step 0.2). Codex/GPT draws separate ChatGPT quota. **Recommended
  starting profile — lowest risk.**
- **`hybrid`** — frontier binaries (Claude/Codex) for judgment + Pi/LiteLLM open-model
  workers for cheap parallel fan-out. Full plan as written.
- **`open-first`** — GLM/Kimi orchestrator, open-model workers, Claude pane for escalation
  only. Most portable for teammates without Max/ChatGPT plans.

Profile is a config value; Mem0, router, context-tiering, herdr panes, and worktree-per-pane
are shared across all profiles.

---

## Tasks

### Sprint 0 — Validation Gates  ·  progress `0%`  ·  *(no router/harness code)*

- [x] **Step 0.1: Repo scaffold & environment inventory** [Simple] ✅ 2026-07-08
  - Depends on: Independent
  - Risk: Low — greenfield, no logic
  - [x] Create private repo skeleton (`/`, `docs/`, `scripts/`, `config/`, `panes/`, `metrics/`, `src/`, `.gsd/`)
  - [x] Record OS + tool versions for Windows/WSL2 in `docs/environments.md` (Mac = TODO at Sprint 6)
  - [x] Add `PLAN.md`, `README.md`, `.gitignore`, `.env.example`
  - Done when: repo clones on both OSes and `docs/environments.md` lists confirmed versions. ✅ (Win/WSL done; Mac pending teammate)

- [x] **Step 0.2: Concurrent-session safety spike** [Spike Needed] ✅ 2026-07-08 — GO
  - Depends on: Step 0.1
  - Risk: High — may invalidate the multi-pane frontier design (#11) → **cleared**
  - [x] Question answered: **10 concurrent `claude` sessions spawned** under one Max login (design needs ~4–5)
  - [x] Windows/WSL2 verified; Mac deferred to Sprint 6 fresh-machine verify
  - [x] Residual (throughput rate-limits under heavy simultaneous load) + stagger/queue fallback recorded
  - [x] `docs/concurrency-report.md` written
  - Done when: report states max safe concurrent sessions + fallback trigger. ✅ (≥10; stagger active generators only if throughput 429s appear)

- [x] **Step 0.3: Baseline-paradox measurement rig** [Spike Needed] ✅ 2026-07-08
  - Depends on: Step 0.1
  - Risk: Medium — measurement harness only, but methodology must be sound
  - [x] Rig built: `scripts/baseline-rig/run.py` (single vs multi via `claude -p --output-format json`)
  - [x] Quality rubric defined in `metrics/quality-rubric.md`
  - [x] Verified end-to-end on trivial-smoke → reproducible tokens+cost; demonstrated baseline paradox (trivial fan-out = NO-GO)
  - [x] ⭐ Finding D15: ~44k per-call system-prompt overhead → worker panes must run lean
  - Done when: rig outputs {tokens_single, tokens_multi, cost} reproducibly. ✅ (quality scored separately per rubric)

- [~] **Step 0.4: Task-class go/no-go decision record** [Medium] — ⏭️ SKIPPED by user 2026-07-09
  - Depends on: Step 0.2, Step 0.3
  - Risk: High — decides what is even worth building (#12). **Skipped → mitigated by D17 policy.**
  - **Policy (D17):** rig is built + ready; each task class defaults to **single-agent** until
    validated with the rig before relying on multi-pane for it. Run per-class later, cheaply.
  - Residual risk accepted: proceeding to build without empirical per-class GO/NO-GO. The lean-worker
    finding (D16, ~60% cheaper workers) and concurrency GO (D14) give strong prior confidence.

### Sprint 1 — Substrate + Frontier Plane  ·  progress `100%`  ·  *(substrate + both frontier CLIs (claude 1.2, codex 1.3) + write-safety + worktree-per-pane all proven headlessly on WSL; Wezterm GUI + Mac visible-pane UX deferred to S06)*

- [x] **Step 1.1: Wezterm + Herdr install & pane layout** [Medium] ✅ 2026-07-09
  - Depends on: Step 0.4
  - Risk: Medium — cross-platform install + socket API learning → cleared
  - [x] Herdr 0.7.3 installed (WSL); headless server + socket API verified without a TTY
  - [x] Standard layout defined in `panes/layout.md`; command reference in `panes/herdr-orchestration.md`
  - [x] Socket API smoke-tested: workspace create/list, pane split, **pane run → wait output → pane read loop PROVEN**
  - [~] Wezterm GUI + Mac: deferred to Sprint 6 (visible-pane UX; headless orchestration works without it)
  - Done when: scripted call spawns layout + reads back pane state. ✅ (Win/WSL headless; GUI/Mac at S6)

- [x] **Step 1.2: Wrap official `claude` binary as frontier pane** [Medium] ✅ 2026-07-09
  - Depends on: Step 1.1
  - Risk: Medium — native login + socket steering, no OAuth piggybacking → cleared
  - [x] Lean `claude -p` worker dispatched into a herdr pane via socket (`pane run`); uses existing native auth
  - [x] Proved read (`pane read`) + steer (`pane run`) + boomerang wait (`wait output`) from orchestrator
  - [x] Model via native `--model`; result='WORKER_OK', $0.0032, ~18× cheaper than default (warm cache)
  - [~] Interactive orchestrator TUI pane + claude integration hook = OPTIONAL polish (deferred; avoids touching heavy ~/.claude)
  - Done when: orchestrator tasks the claude pane + captures reply via socket, official binary + native auth only. ✅

- [x] **Step 1.3: Wrap official `codex` binary as frontier pane** [Medium] ✅ 2026-07-10
  - Depends on: Step 1.1
  - Risk: Medium — same pattern as 1.2 for a different CLI → cleared
  - [x] Lean codex (GPT) worker proven S01/T03: `scripts/lean-codex-worker.sh` dispatches a headless `codex exec --json` worker via herdr `pane run`; native ChatGPT login, `--ignore-user-config` keeps it lean (~12.5k vs Claude's ~44k overhead)
  - [x] Read + steer from orchestrator proven via the same socket loop as 1.2 (`pane run` → `wait output` → `pane read`); JSONL final answer is the last `item.completed` agent_message
  - [~] Interactive frontier pane = `herdr agent start -- codex` (+ `integration install codex` for TUI idle/working/done state); optional polish, same as the 1.2 orchestrator-pane deferral
  - Done when: orchestrator can task the codex pane and capture its reply via socket. ✅ (lean worker + pane path proven S01/T03)

- [x] **Step 1.4: write-safety (advisory lock; claude-presence deferred)** [Medium] ✅ 2026-07-09
  - Depends on: Step 1.2
  - [x] Primary = worktree isolation (T05). scripts/pane-lock.sh (flock) serializes shared-checkout writers — verified 3 concurrent, no interleave
  - [~] Full claude-presence (registry + broadcast inbox) deferred until multi-session same-repo need
  - Done when: two panes on the same file are serialized by an advisory lock. ✅

- [x] **Step 1.5: Git worktree-per-pane scaffolding** [Medium] ✅ 2026-07-09
  - Depends on: Step 1.1
  - [x] `herdr worktree create --branch --base --path` gives each pane an isolated worktree (verified created + git-visible + removed)
  - [x] Planner (main worktree) owns merge-back
  - Done when: concurrent edits in separate worktrees merge back with no lost changes. ✅ (isolation verified; merge-back flow in S03)

### Sprint 2 — Workhorse Plane  ·  progress `60%`  ·  *(2.1 gateway✅ 2.3 tool-subsets✅ 2.4 repair✅; 2.2 live Pi worker + 2.5 constrained-decoding + 2.4 measurement need a provider key)*

- [x] **Step 2.1: LiteLLM gateway (Docker) + model routing config** [Medium]  ✅ 2026-07-10 (gateway boots+health+9 aliases; live routing awaits a key)
  - Depends on: Step 0.4
  - Risk: Medium — multi-provider keys + config
  - [ ] `docker compose` service for LiteLLM; add Kimi/GLM/DeepSeek/MiniMax via API keys in `.env`
  - [ ] Encode the task-category → model table (from the model-strategy docs) in `config/litellm.yaml`
  - [ ] Verify each model returns a completion through the unified endpoint
  - Done when: a single OpenAI-compatible call reaches every configured workhorse model successfully.

- [ ] **Step 2.2: Pi install & minimal worker spawn** [Medium]
  - Depends on: Step 1.1, Step 2.1
  - Risk: Medium — harness wiring
  - [ ] Install Pi; point `pi-ai` at the LiteLLM endpoint
  - [ ] Spawn a Pi worker in a herdr pane; run a trivial task on a cheap model
  - Done when: a Pi worker completes a trivial task via LiteLLM inside a herdr pane, readable from the orchestrator.

- [x] **Step 2.3: Per-worker tool subsets** [Medium]  ✅ 2026-07-10 (tool-profiles.json; extract≠code verified; live check folds into 2.2)
  - Depends on: Step 2.2
  - Risk: Medium — tool-scoping per task category
  - [ ] Define tool profiles per category (e.g., extraction worker = Read/Write/3 tools, not 30) in `config/tool-profiles.yaml`
  - [ ] Verify a worker only exposes its profile's tools
  - Done when: two workers of different categories start with different, correct tool sets.

- [x] **Step 2.4: Tool-call schema + validator + repair Pi extension** [Complex]  ✅ 2026-07-10 (validator+repair loop tested; Pi ext loads; measurement needs key)
  - Depends on: Step 2.2
  - Risk: High — core reliability logic for weak open-model tool-calling
  - [ ] Build a Pi TypeScript extension: validate every tool call against a schema (Zod/Pydantic-equivalent)
  - [ ] On invalid call, feed the exact error back and re-prompt (repair loop, bounded retries)
  - [ ] Measure tool-call success rate before/after on a flaky model (e.g., a cheap DeepSeek/Qwen tier)
  - Done when: measured tool-call validity on a chosen open model improves by a recorded margin with the repair loop on.

- [ ] **Step 2.5: Constrained decoding where supported** [Medium]
  - Depends on: Step 2.4
  - Risk: Medium — provider-dependent feature
  - [ ] Enable structured-output/JSON-schema mode on providers that support it via LiteLLM
  - [ ] Verify schema-valid tool JSON is guaranteed for those providers
  - Done when: for a schema-mode-capable model, malformed tool JSON no longer occurs across a test batch.

### Sprint 3 — Router + Context Tiering  ·  progress `100%`  ·  *(core + rtk/CCE pilots done; verdict = keep both)*

- [x] **Step 3.1: Deterministic rule-based router** [Complex]  ✅ 2026-07-09
  - Depends on: Step 2.2, Step 1.2
  - Risk: High — central control logic
  - [ ] Implement router: task category → {plane, model} using GO classes from Step 0.4
  - [ ] LLM-judgment path only for ambiguous handoffs, with its token cost logged separately
  - [ ] Unit-test the mapping table against a fixture of tasks
  - Done when: a fixture set of tasks each route to the correct plane+model deterministically; ambiguous ones log a costed judgment call.

- [x] **Step 3.2: TOON task-spec format** [Medium]  ✅ 2026-07-09
  - Depends on: Step 3.1
  - Risk: Medium — new serialization for specs
  - [ ] Adopt TOON for plan/task-spec artifacts; helper to emit/parse
  - [ ] Verify a task spec round-trips and measures fewer tokens than the JSON equivalent
  - Done when: task specs are emitted as TOON and a token comparison vs JSON is recorded.

- [x] **Step 3.3: Reference > Compressed > Full boundary enforcement** [Complex]  ✅ 2026-07-09
  - Depends on: Step 3.1
  - Risk: High — the core token-efficiency invariant (#1)
  - [ ] Enforce that content crossing a pane boundary is a reference/pointer or summary, never raw full content by default
  - [ ] Add a guard that flags/blocks full-content passing unless explicitly justified
  - Done when: a test attempting to pass full content across a boundary is downgraded to reference/compressed or flagged.

- [x] **Step 3.4: rtk CLI-output compression proxy** [Medium]  ✅ 2026-07-10 (rtk 0.43.0 ADOPTED — 81–99.6% compression)
  - Depends on: Step 3.1
  - Risk: Medium — wrapping external tool output
  - [ ] Route git/test/lint output through rtk before it enters a pane's context
  - [ ] Verify compressed output preserves actionable signal on a real repo
  - Done when: a noisy command's output is materially smaller in-context with no loss of the failing detail.

- [x] **Step 3.5: CCE pilot + fallback chain** [Complex]  ✅ 2026-07-10 (CCE 0.4.25 retained (provisional))
  - Depends on: Step 3.3
  - Risk: High — immature dependency, must degrade safely (#8)
  - [ ] Integrate CCE (Code Context Engine) as a Reference-tier retrieval source
  - [ ] Implement the explicit fallback **CCE index → plain file path → Compressed**
  - [ ] Verify that disabling/breaking CCE silently falls back without routing to the expensive tier
  - Done when: with CCE forced to fail, retrieval still returns correct context via file-path/compressed fallback.

- [x] **Step 3.6: context-mode vs rtk+CCE consolidation pilot** [Spike Needed]  ✅ 2026-07-10 (KEEP BOTH — docs/context-tooling-decision.md)
  - Depends on: Step 3.4, Step 3.5
  - Risk: Medium — dependency-count decision
  - [ ] Spike (time-box): run context-mode head-to-head against rtk+CCE on the same tasks
  - [ ] Compare token reduction, correctness, and setup cost; record verdict in `docs/context-tooling-decision.md`
  - Done when: a documented decision states whether context-mode replaces rtk+CCE or not, with numbers.

- [x] **Step 3.7: agent-comms P2P mesh (exception routing)** [Medium]  ✅ 2026-07-09
  - Depends on: Step 3.1
  - Risk: Medium — networking, but scoped to exceptions
  - [ ] Stand up agent-comms localhost TCP mesh bridging claude/codex/Pi panes
  - [ ] Restrict usage to lateral/exception clarification (chain-of-command is default, #4)
  - Done when: a blocked worker can request a specific fact from a peer pane, and default routing still goes through the parent.

- [x] **Step 3.8: Ponytail YAGNI prompt fragment** [Simple]  ✅ 2026-07-09
  - Depends on: Step 2.2
  - Risk: Low — prompt-only change
  - [ ] Apply the reduced Ponytail YAGNI fragment to worker system prompts
  - [ ] Verify no regression on a sample task
  - Done when: worker prompts include the fragment and a sample task still passes.

- [x] **Step 3.9: Router overhead instrumentation** [Medium]  ✅ 2026-07-09
  - Depends on: Step 3.1
  - Risk: Medium — measurement feeding acceptance (#10)
  - [ ] Log router LLM-judgment token cost as its own line item (never inside "savings")
  - Done when: a run report shows router overhead as a distinct, summable metric.

### Sprint 4 — Memory (Tier-1 working + Mem0 Tier-2)  ·  progress `100%`  ·  *(all seams + real Mem0 LIVE; only 4.5 live recall-vs-handover comparison is a usage residual)*

- [x] **Step 4.1: Boomerang + shared task store (Tier-1)** [Medium]  ✅ 2026-07-09
  - Depends on: Step 3.1
  - Risk: Medium — file-locked shared state
  - [ ] Implement pi-tasks-style file-locked shared store (claim/complete/cascade)
  - [ ] Workers collapse their exchange into a short summary before reporting up (boomerang)
  - Done when: an orchestrator run shows workers reporting summaries only, with the store coordinating claims atomically.

- [x] **Step 4.2: Validation gate before compression** [Complex]  ✅ 2026-07-09
  - Depends on: Step 4.1
  - Risk: High — correctness of what gets remembered (#6)
  - [ ] A result must pass a deterministic check (tests/lint/scope-match) before it may be summarized
  - [ ] Failures propagate in full detail, never smoothed into a clean summary
  - Done when: an intentionally-failing result is passed through in full and is NOT summarized; a passing one is summarized.

- [x] **Step 4.3: Mem0 deploy (Docker)** [Medium]  ⏸️ DEFERRED (needs Docker — user 2026-07-09; mock adapter used meanwhile)  ✅ 2026-07-09 (built from source — prebuilt is arm64-only; live add/search verified)
  - Depends on: Step 2.1
  - Risk: Medium — new service, wired to LiteLLM
  - [ ] `docker compose` service for Mem0 (self-host); configure its LLM calls via LiteLLM
  - [ ] Verify store + retrieve of a memory works end-to-end
  - Done when: a fact written to Mem0 is retrievable by semantic query through the deployed service.

- [x] **Step 4.4: Promotion filter (Tier-1 → Mem0)** [Complex]  ✅ 2026-07-09 (against mock Mem0 adapter; real Docker deploy deferred)
  - Depends on: Step 4.2, Step 4.3
  - Risk: High — prevents memory bloat / bad-fact contamination
  - [ ] At run end, distill only validated keeper summaries/decisions/prefs into Mem0 (not everything)
  - [ ] Verify non-keeper/failed items are excluded
  - Done when: after a run, Mem0 contains only the validated keepers and none of the discarded scratch.

- [x] **Step 4.5: Session-start recall (retire handover)** [Complex]  ✅ 2026-07-09 (against mock Mem0 adapter; real Docker deploy deferred)
  - Depends on: Step 4.4
  - Risk: High — replaces an existing critical workflow
  - [ ] Orchestrator queries Mem0 top-k relevant at session start; scope is cross-project
  - [ ] Compare a resumed session's context quality vs the old manual handover
  - Done when: a fresh session auto-recalls prior relevant context (few-hundred-token injection) without a manual handover doc.

### Sprint 5 — Workflow Skills + Generalization  ·  progress `100%`  ·  *(Pi skills brainstorm→…→auto + Phase-0 gate authored + discovery-verified)*

- [x] **Step 5.1: Pi skills mirroring brainstorm→explore→plan→execute→auto** [Complex]  ✅ 2026-07-10 (Pi skills under .pi/skills/; discovery+smoke verified)
  - Depends on: Step 3.1, Step 4.5
  - Risk: Medium — UX/workflow surface for the team
  - [ ] Author Pi skills/prompt-templates for each stage matching current muscle memory
  - [ ] Verify each skill runs and chains to the next
  - Done when: a user can run brainstorm→explore→plan→execute→auto through Pi skills end-to-end.

- [x] **Step 5.2: Phase-0 conversational alignment gate** [Medium]  ✅ 2026-07-10 (Pi skills under .pi/skills/; discovery+smoke verified)
  - Depends on: Step 5.1
  - Risk: Medium — process gate (#5)
  - [ ] Require a user↔orchestrator alignment exchange before any plan is generated; model tier via `/model`
  - Done when: plan generation is blocked until an alignment step is recorded.

### Sprint 6 — Cross-Platform Self-Installing Repo  ·  progress `80%`  ·  *(installers+compose done; install.sh live-verified; only 6.5 fresh-machine Win+Mac acceptance remains)*

- [x] **Step 6.1: `install.sh` (mac/WSL) idempotent bootstrap** [Complex]  ✅ 2026-07-09 (LIVE-verified idempotent no-op on WSL)
  - Depends on: Step 1.1, Step 2.1, Step 4.3
  - Risk: High — must be idempotent + OS-detecting
  - [ ] Detect OS; install Wezterm + Herdr + Pi + Node if missing; write configs; `docker compose up`; verify; report ready
  - [ ] Re-running it makes no destructive changes
  - Done when: on a clean mac/WSL, one command yields a ready-to-use rig; a second run is a no-op.

- [x] **Step 6.2: `install.ps1` (Windows) idempotent bootstrap** [Complex]  ✅ 2026-07-09 (authored; Windows live-run = 6.5)
  - Depends on: Step 6.1
  - Risk: High — Windows parity with 6.1
  - [ ] PowerShell equivalent of 6.1 (herdr Windows-beta path); same verify + ready report
  - Done when: on a clean Windows machine, one command yields a ready-to-use rig; a second run is a no-op.

- [x] **Step 6.3: docker-compose for LiteLLM + Mem0** [Medium]  ✅ (deploy/docker-compose.yml, live this session; LiteLLM optional/hybrid-only)
  - Depends on: Step 2.1, Step 4.3
  - Risk: Medium — service orchestration
  - [ ] Single compose file brings up LiteLLM + Mem0 with volumes for persistence
  - Done when: `docker compose up` starts both services healthy on both OSes.

- [x] **Step 6.4: `.env` + secrets handling + config templating** [Medium]  ✅ (.env templating folded into installers)
  - Depends on: Step 6.3
  - Risk: Medium — secret hygiene
  - [ ] `.env.example` → generated `.env`; API keys for open models only; frontier uses native login
  - [ ] Config templates rendered per machine on install
  - Done when: a teammate fills `.env` from the example and all services + workers authenticate.

- [ ] **Step 6.5: Fresh-machine install verification (Win + Mac)** [Complex]
  - Depends on: Step 6.1, Step 6.2, Step 6.4
  - Risk: High — the "teammate can use it" acceptance
  - [ ] Clean-machine (or fresh VM) install on Windows and Mac; run one real task class end-to-end
  - Done when: a teammate who never saw the repo goes from `git clone` to a completed task on both OSes.

### Sprint 7 — Instrumentation + Acceptance  ·  progress `100%`  ·  *(pure-code harness done; live per-class sign-off needs baseline runs — D17)*

- [x] **Step 7.1: Metrics pipeline** [Complex]  ✅ 2026-07-09
  - Depends on: Step 3.9, Step 4.5
  - Risk: Medium — data plumbing across panes
  - [ ] Capture per-run: token reduction vs single-agent baseline, quality score, retry rates, router overhead
  - Done when: each run emits a structured metrics record with all four metrics.

- [x] **Step 7.2: Acceptance dashboard/report** [Medium]  ✅ 2026-07-09
  - Depends on: Step 7.1
  - Risk: Low — reporting over existing data
  - [ ] Report/dashboard showing the four metrics vs the #10 targets
  - Done when: a report renders the metrics against ≥20% token / ≤5% quality / retry / overhead targets.

- [x] **Step 7.3: Per-task-class acceptance sign-off** [Medium]  ✅ 2026-07-09 (decision harness; LIVE per-class sign-off = D17 residual, needs baseline runs)
  - Depends on: Step 7.2
  - Risk: Medium — go-live gating per class
  - [ ] For each GO class from Step 0.4, confirm live metrics meet the acceptance targets; sign off or revert to single-agent
  - Done when: every GO task class is either signed off against targets or explicitly reverted to single-agent.

---

### Sprint 8 — Production Readiness / Integrated Control Plane  ·  progress `Phase A 2/9`  ·  *(8.1 coordinator + 8.2 e2e ✅ — the enforced `gopilot run` pipeline exists, 182/182)*

> Source: independent production-readiness review in `docs/GPT-FINDINGS.md` (2026-07-10) + Claude's assessment.
> Decision (D33): the review is accepted; approach is **phased** — **Phase A (adoptable)** builds the missing
> *enforced run path* + measurement + cheap reproducibility so the rig is a credible teammate-adoptable tool
> now; **Phase B (production)** hardens for shared/hosted use and is DEFERRED/tracked. Core premise (build the
> coordinator, then prove the token claim) — not more features. Existing S00–S07 modules become internal libraries.

#### Phase A — Adoptable (build now)

- [x] **Step 8.1: Run coordinator + `gopilot run` CLI (dry-run first)** [Complex] ✅ 2026-07-11
  - Depends on: Step 3.1, Step 3.3, Step 4.2, Step 4.4, Step 7.1 (existing modules as libraries)
  - Risk: High — becomes the single enforced execution path; central control logic
  - [ ] `src/coordinator/run.mjs` composing: profile+config validation → task classify/accept → per-class sign-off gate → deterministic router → context-budget/boundary → dispatcher adapter → tool-profile select → result validation → memory promotion → metrics/verdict persist
  - [ ] `--dry-run` prints route, model, tools, context tier, expected dispatch WITHOUT invoking a model
  - [ ] Treat lower-level modules as internal libraries; shells/herdr commands remain diagnostics only
  - Done when: `gopilot run --dry-run "<task>"` prints the full governed plan; a run cannot skip a policy stage.

- [x] **Step 8.2: Portable fake-provider + fake-dispatcher end-to-end test** [Complex] ✅ 2026-07-11
  - Depends on: Step 8.1
  - Risk: Medium — must prove policy invocation without network/ports/CLIs
  - [ ] In-process fake model provider + fake dispatcher; drive a full run through the coordinator
  - [ ] Assert every stage fired (route chosen, boundary applied, gate ran, promotion filtered, metrics persisted)
  - Done when: one hermetic test drives an end-to-end governed run with no sockets/CLIs and asserts each policy invoked.

- [ ] **Step 8.3: Split test suites (unit / integration / live)** [Medium]
  - Depends on: Independent
  - Risk: Medium — reorganizes test invocation; must keep 174 green
  - [ ] `test:unit` = hermetic (no localhost listeners/CLIs); move mesh + mem0-client fake-server + rtk/cce live tests to `test:integration`/`test:live`
  - [ ] Live tests explicitly skip-with-reason when a dep (port bind, tool, service) is unavailable
  - Done when: `npm run test:unit` passes on a locked-down runner (no port binds); integration/live self-skip cleanly.

- [ ] **Step 8.4: Correct metrics & acceptance accounting** [Medium]
  - Depends on: Step 7.1 (metrics), Step 3.9 (overhead)
  - Risk: Medium — changes how acceptance passes/fails; must not mask regressions
  - [ ] Portfolio token reduction from aggregate totals `(Σsingle − Σmulti)/Σsingle`, not equal-weighted per-run %
  - [ ] Retain per-run/per-class distributions; report median, p90, stdev/CI, sample count
  - [ ] Replace the fixed 1,500-token judgment estimate with ACTUAL router usage; include repair/retry/context/memory/summarization tokens in totals
  - Done when: acceptance reconciles to provider/CLI usage totals and cannot pass via unweighted-average distortion.

- [ ] **Step 8.5: Cheap deployment reproducibility hardening** [Medium]
  - Depends on: Step 2.1, Step 4.3
  - Risk: Medium — deploy-config change; must keep local dev frictionless
  - [ ] Pin LiteLLM image by digest; pin the Mem0 source revision; build a reproducible Mem0 image (deps at build time, no pip-install on every startup)
  - [ ] Bind Mem0/LiteLLM to `127.0.0.1`; add a prod compose override that FAILS startup on missing secrets (no dev defaults in prod)
  - [ ] Split dev vs prod compose; add real readiness checks (deps, not just process liveness)
  - Done when: a pinned prod compose boots without dev-default secrets and a second run is byte-reproducible.

- [ ] **Step 8.6: Task-store state machine + leases** [Complex]
  - Depends on: Step 4.1 (store)
  - Risk: High — concurrency/correctness of shared state and recovery
  - [ ] Enforce `pending → claimed → validating → done|failed`; claim only when deps complete; require claim-token/owner to complete
  - [ ] Atomic writes (temp+rename); claim lease + heartbeat + expiry + stale-claim recovery; explicit failure/retry state
  - Done when: invalid transitions are rejected and a crash-recovery test shows no task is permanently stranded.

- [ ] **Step 8.7: Token-aware boundary + structured failure preservation** [Medium]
  - Depends on: Step 3.3 (boundary)
  - Risk: Medium — changes truncation; must not drop diagnostics
  - [ ] Enforce limits in estimated/provider-reported TOKENS (not chars) for the selected model
  - [ ] Preserve command/exit-code/failing-test/file/line/first+final error; head-and-tail truncation for logs; store full output as an artifact + pass a reference
  - Done when: boundary stays within the model's token budget while preserving the actionable failure signal (assert via a failing-command fixture).

- [ ] **Step 8.8: Finish live workhorse path (Pi → LiteLLM)** [Complex]  ·  *(= S02 Steps 2.2/2.5 + 2.4 measurement)*
  - Depends on: Step 8.1, provider key (OpenRouter) in `deploy/.env`
  - Risk: High — the hybrid profile's primary cost path; live provider integration
  - [ ] Pi defaults to `LITELLM_BASE_URL`/`LITELLM_MASTER_KEY` for hybrid/open-first; resolve routed alias dynamically (no hard-coded model); fail-closed on inactive/uncredentialed model
  - [ ] Provider capability checks (tools, JSON-schema, context, streaming); complete constrained decoding where supported
  - [ ] Measure tool-call validity before/after repair on a real workhorse model
  - Done when: a real task completes through Pi → LiteLLM → provider → tool-validation → repair → metrics.

- [ ] **Step 8.9: Prove the token-efficiency claim (per-class benchmark campaign)** [Spike Needed]
  - Depends on: Step 8.1, Step 8.4, Step 8.8; task fixtures + Max/provider quota
  - Risk: High — validates the entire product hypothesis; consumes quota
  - [ ] Spike (time-boxed): stable benchmark suite per task class (small/med/large from real repos), fixtures under `scripts/baseline-rig/tasks/`
  - [ ] Compare single-frontier vs pure-anthropic-multi vs hybrid-multi (+open-first where applicable), repeated trials; record all token/latency/cost/quality; publish break-even thresholds
  - [ ] Sign off only classes that pass ≥20% token / ≤5% quality; keep the rest single-agent (fill `docs/task-class-decisions.md`)
  - Done when: every enabled multi-agent class meets the targets on repeated representative trials, reconciled to real usage.

#### Phase B — Production hardening (DEFERRED / tracked — hosted/shared-use bar)

- [ ] **Step 8.10: Hardened IPC (agent-comms)** [Complex] — Depends on Step 3.7 · Risk: Med — Unix sockets or per-run auth tokens, message-size/connection/concurrency limits, schema validation, correlation IDs, bounded sanitized errors. Done when: unauthorized peers + oversized messages are rejected in automated tests. **DEFERRED.**
- [ ] **Step 8.11: Reliability & recovery** [Complex] — Depends on Step 8.1, 8.6 · Risk: High — durable run/task IDs, persisted lifecycle events, idempotent dispatch/complete, cancellation+timeouts, finally/cleanup for panes+worktrees, startup reconciliation, backoff+jitter, circuit breakers. Done when: killing the orchestrator at each stage recovers with no lost/duplicated work. **DEFERRED.**
- [ ] **Step 8.12: Production observability** [Complex] — Depends on Step 8.1 · Risk: Med — structured JSON events per run/task/route/call/retry/validation/memory; tokens/cost/latency/TTFT/success/retry/repair/queue/compression by class+profile+model+provider+prompt-version; redaction; alerts; run-inspection command. Done when: a failed/expensive run is diagnosable from its run ID. **DEFERRED.**
- [ ] **Step 8.13: Config & model governance** [Medium] — Depends on Step 3.1 · Risk: Med — typed config schema validated at startup, alias existence/active checks, capability metadata, model-version pinning, `config doctor` command, resolved model/provider recorded per run. Done when: invalid/incomplete profiles fail before dispatch. **DEFERRED.**
- [ ] **Step 8.14: Production security & data hardening** [Complex] — Depends on Step 8.5 · Risk: High — enable Mem0 auth in prod, no default secrets, container+dependency vuln scanning, backup/restore + migration rollback procedures. Done when: a pinned deployment passes a security checklist and can be backed up/restored/upgraded/rolled back. **DEFERRED.**
- [ ] **Step 8.15: Cross-platform clean-machine acceptance** [Complex] — Depends on Step 6.1, 6.2, 8.5 · Risk: High — clean Win/WSL2/macOS-Intel/macOS-AS install+upgrade+uninstall+compose+herdr+pi+claude+codex+cce+rtk+worktrees+locks; per-OS smoke scripts; record supported versions. Done when: the documented quickstart succeeds unmodified on every claimed platform. **DEFERRED (needs machines/teammate — supersedes Step 6.5).**
- [ ] **Step 8.16: Controlled pilot + go-live** [Spike Needed] — Depends on all Phase A + B · Risk: High — freeze/version the first supported config, publish benchmark+acceptance results, incident-response/rollback/retention/privacy docs, run a limited real-project pilot for a defined observation period. Done when: a trusted pilot meets defined reliability/quality/token/cost/latency targets. **DEFERRED.**

---

## Rollback Plan

- **What to revert:** feature is additive and self-contained in the private repo. Revert = stop the rig; nothing is embedded in your existing projects.
- **Per-service:** `docker compose down` stops LiteLLM + Mem0 (volumes retain data; delete volumes to purge memory).
- **Frontier plane:** uses official binaries with native login — removing the rig leaves `claude`/`codex` untouched.
- **Data impact:** Mem0 store is the only persisted state; it is disposable and rebuildable. Git worktrees are removable; unmerged worktrees can be discarded.
- **Rollback steps:** (1) stop herdr sessions, (2) `docker compose down` [+ `-v` to purge memory], (3) remove worktrees, (4) uninstall herdr/Pi if desired — all reversible, no lock-in.

## Definition of Done

- [ ] All steps ticked with acceptance criteria met
- [ ] Sprint 0 gate passed and recorded (`docs/task-class-decisions.md`)
- [ ] Concurrent-session safety confirmed on both OSes (`docs/concurrency-report.md`)
- [ ] Numeric acceptance met per GO class: ≥20% token reduction, ≤5% quality tolerance, retry rates tracked, router overhead reported separately
- [ ] Fresh-machine install verified on Windows **and** Mac by a teammate
- [ ] Open-model tool-call repair loop shows measured reliability gain
- [ ] Mem0 session-start recall demonstrably replaces the manual handover ritual
- [ ] No debug artifacts/TODOs in committed code; lint + any tests pass
- [ ] Reviewed via `/review`
- [ ] Memory files + `README.md` updated for teammate onboarding

- [ ] **(Sprint 8)** A single `gopilot run` command enforces the full workflow; a dry-run prints the governed plan
- [ ] **(Sprint 8)** Portable `test:unit` suite is hermetic (passes with no localhost listeners); integration/live self-skip
- [ ] **(Sprint 8)** Acceptance metrics use workload-weighted totals + distributions and reconcile to real provider/CLI usage
- [ ] **(Sprint 8)** Hybrid Pi → LiteLLM → provider path is live and measured; every enabled multi-agent class has passing evidence
- [ ] **(Sprint 8, Phase B — deferred)** IPC auth, reliability/recovery, observability, prod secrets/pinning, cross-platform acceptance

## Future Considerations (out of scope for this plan)

- Hermes in a side pane for a "grows-with-you" personal assistant memory.
- Letta swap-in if agents later need self-editing 3-tier memory + git context repositories.
- LLMLingua-2 prompt pre-compression for very large docs/transcripts before a worker call.
- Hosting LiteLLM/Mem0 on a shared VPS if the team wants centralized memory instead of per-machine local.
