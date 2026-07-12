# Go-pilot Live Test Campaign — Plan (v2)

**Date:** 2026-07-12 · **Status:** PLAN (no execution yet) ·
**Goal:** One frozen, pre-registered, multi-trial campaign measuring **token
efficiency, cost ($), and output quality** WITH go-pilot vs WITHOUT — ending with
a full "what it would have cost without go-pilot" comparison **and** honest
overhead/failure accounting.

**v2 folds in an external design review (Codex).** Scope claim is explicit:
this is a **directional efficiency proof on a fixed sample**, not yet a
production-grade "consistently better" proof. The gates below make the
directional result *defensible*, not hand-wavy.

---

## 0. What this can and cannot claim (stated up front)

- **CAN answer:** "On a frozen 28-task suite over 3 trials, is go-pilot cheaper
  and within a defined quality band vs (a) all-Opus and (b) the same models with
  no go-pilot machinery?"
- **CANNOT yet answer:** "This architecture is production-grade and consistently
  better across repos/workloads." That needs many-repo, many-run soak testing
  (a later campaign).

---

## 1. Confirmed environment

| Piece | Value |
|---|---|
| Workhorse gateway | Ikey `https://ikey-gateway.fly.dev/v1` (OpenAI-compatible) |
| Key | gitignored `deploy/.env` → `WORKHORSE_GATEWAY_KEY` (rotate after this round) |
| Workhorse models | `test/kimi-k2.6`, `test/deepseek-v4-pro` — **both reasoning models** (billed `reasoning_tokens`) |
| Frontier (orchestrator/judge) | Claude **Opus 4.8** via Claude CLI (Max plan; flat fee, priced at API rates for the report) |
| Cost source | gateway `/key/info.spend` = **exact cumulative $** (verified). Attributed per-model via serial spend deltas. |
| **Budget (updated)** | **Kimi ≤ $5**, **DeepSeek ≤ $2**, **total workhorse backstop $7**. Projected actual ≈ a few cents (~$1.7/M tokens). |

**Phase 0 connectivity: DONE.** Both models list + respond; `usage` returns
prompt/completion/**reasoning**/cached tokens; `/key/info.spend` moves per call.
Kimi returned **empty** content at `max_tokens:20` (reasoning ate the cap) →
**generous output budgets are mandatory.**

---

## 2. Pre-registered success gates (defined BEFORE running)

A category is declared a **go-pilot win** only if BOTH hold, on the trial
medians:

1. **Quality floor:** Arm A median quality ≥ **95%** of Arm B (≤5% drop).
2. **Efficiency:** Arm A **$ cost ≤ 60%** of Arm B (≥40% cheaper) **AND** Arm A
   total tokens < Arm C tokens (compression actually reduces context) at ≤5%
   quality delta vs Arm C.

Any category that fails the quality floor is reported as **"keep on Opus / not
signed off"** (this mirrors the D17 sign-off logic). Thresholds are frozen here
so the verdict cannot be reverse-engineered after seeing results.

---

## 3. The three arms — clean factorial (Arm C fixed per review)

| Arm | Model per task | Context | Machinery | Isolates |
|---|---|---|---|---|
| **A — go-pilot** | routed model `M_t` (per §4) | compressed / tiered / bounded | full (route, plan, validate, retry, metrics) | the product |
| **B — all-Opus naive** | Opus for every task | **naive full** (see def) | none | full stack **incl. model-swap** (B vs A) |
| **C — same-model naive** | **the same `M_t` as Arm A** | **naive full** | none | **compression/machinery only, model held constant** (C vs A) |

- **A vs C** = pure go-pilot machinery effect (model constant).
- **B vs A** = full stack including routing to cheaper models.
- **B vs C** = model-swap effect (both naive).

**"Naive full context" — precise definition:** the complete task inputs (every
supplied file/document + the task prompt) concatenated verbatim, **no**
retrieval-bounding, **no** compression, **no** tiering; truncated only if it
exceeds the model's context window (truncation logged). The **raw input corpus is
identical** across A/B/C for a given task — only go-pilot's handling differs.

---

## 4. Frozen task manifest — 28 tasks, 7 areas × 4

Committed as `scripts/baseline-rig/tasks/*.json` and **content-hashed** before the
run (task id, prompt, inputs, expected answer / unit tests, rubric, assigned
model `M_t`, model settings: `temperature`, `max_tokens`, `top_p`). The manifest
hash goes in the report so results are reproducible.

| # | Area | Ground truth | Arm-A model | Example |
|---|---|---|---|---|
| 1 | Mathematical reasoning | exact numeric/symbolic | DeepSeek | multi-step, proofs, probability |
| 2 | Coding (self-contained) | hidden unit tests | DeepSeek | implement/fix a function |
| 3 | Document QA | rubric + citations | Kimi | long-doc questions, no hallucination |
| 4 | Analysis / synthesis | rubric | Kimi | structured trade-off / argument |
| 5 | Extraction / summarization | rubric + faithfulness | Kimi | schema extraction, faithful summary |
| 6 | Multi-step agentic reasoning | task success + rubric | DeepSeek | plan-then-solve constrained task |
| 7 | **Repo-change (coding-agent)** | **workspace diff + tests** | DeepSeek | multi-file edit, test-failure fix, config repair, doc update in a throwaway git fixture; verified by actual diff + test run |

Area 7 is **new (per review)** because go-pilot *is* a coding-agent harness — it
exercises the real workspace/checkpoint/diff path (`src/runtime/workspace.mjs`),
not just chat. Difficulty is skewed hard throughout.

Model settings are pinned per task. Reasoning models are non-deterministic even
at `temperature:0`, which is exactly why we repeat trials (§5).

---

## 5. Repeat trials + randomization (per review)

- **3 trials per task per arm** (28 × 3 × 3 = 252 task-runs). Enough to report
  spread, not just a point estimate. (Trial count is the first knob to cut if
  Opus rate limits bite — it degrades gracefully to "labelled single-pass".)
- **Randomized arm order per (task, trial)** using a **fixed seed** (recorded),
  so arm sequence can't create cache / rate-limit / provider-state bias, yet the
  ordering stays reproducible.
- **Frozen manifest** (§4) + fixed seeds/settings = a rerun reproduces inputs
  exactly; only model stochasticity varies (which the trials capture).

---

## 6. Quality grading — two judges + calibration (per review)

- **Deterministic where truth exists:** math → exact/numeric match; coding (areas
  2 & 7) → run hidden unit tests / verify the workspace diff. No LLM judge needed.
- **Blind dual-judge for open-ended (areas 3–6, rubric part of 7):**
  - **Primary judge: Opus** (blind — outputs shuffled, arm/model labels stripped).
  - **Co-judge: DeepSeek** (cheap) scores the same outputs blind.
  - **Why two:** Opus both *produces* Arm B and *judges* → self-preference risk.
    A second independent judge exposes it. Report **inter-judge agreement**
    (Cohen's κ / correlation); use the **mean** score and **flag disagreements**
    (|Δ| ≥ 2) for manual spot-check.
  - **Calibration anchors:** 3–5 pre-scored gold examples per rubric dimension are
    shown to each judge to anchor the 1–10 scale.
- Rubric dimensions: correctness, completeness, reasoning quality, faithfulness.

---

## 7. Metrics — quality, cost, AND failures + overhead (per review)

Per task-run, persisted as JSONL (go-pilot event log + campaign ledger):

**Efficiency:** prompt / completion / **reasoning** / **cached** tokens · actual
$ · latency · context tier.

**Failure accounting (first-class, per review):** empty output, refusal, timeout,
malformed/invalid JSON, retries, validation repairs, budget-skips — each counted,
not folded into "quality".

**End-to-end overhead (per review) — reported SEPARATELY, never netted:** for
Arm A, break out orchestration tokens, planner-call tokens, validator-call
tokens, retry/repair tokens, and (campaign-level) judging + report-generation
tokens. This makes go-pilot's *real* cost visible — a cheaper task model doesn't
count if routing/planning/validation overhead eats the savings.

**Cache:** record `cached_tokens` per call and whether cacheable prompt prefixes
were identical across tasks (go-pilot's `buildPrompt` fingerprint vs the naive
arms).

---

## 8. Budget enforcement (updated caps)

1. **Exact accounting:** read `/key/info.spend` before/after each workhorse call;
   attribute the delta to that call's model (serial → exact).
2. **Per-model caps:** stop scheduling **Kimi** at **$5**, **DeepSeek** at **$2**;
   log dropped task-runs (never silent).
3. `contract.maxCostUsd` as a secondary per-run guard; **$7 total** key backstop.
4. **Checkpoint + resume (per review):** the campaign persists a checkpoint after
   every task-run (reuses the 8.11 journal `dispatchOnce`/`reconcile`), so a
   Max-plan rate-limit pause or a crash **resumes cleanly without repeating
   completed runs or double-spending**.

---

## 9. Statistical reporting (per review)

Not just totals. Per arm and per category report: **median, p75, p95**, mean,
and **bootstrap 95% confidence intervals** (resample over trials/tasks) for
tokens, $, latency, and quality. Deltas (WITH vs WITHOUT) reported **with their
CIs** so "20% cheaper" comes with a range, not a bare number. (`src/metrics/
stats.mjs` gains p75/p95 + a bootstrap helper.)

---

## 10. Final deliverable — `docs/live-test-results.md`

- **Manifest hash + seeds + budget actuals + model settings** (reproducibility header).
- **Per-task × per-arm** table (median over trials): tokens, $, quality, latency, failures.
- **Headline:** total tokens & $ per arm; **WITH vs WITHOUT** → % token reduction,
  **% cost reduction**, quality delta — each with a bootstrap CI and n.
- **Two "without" numbers:** vs all-Opus (full stack) and vs same-model-naive
  (compression only) — the two effects separated by the factorial.
- **Overhead ledger:** go-pilot's orchestration/plan/validate/retry/judge tokens
  broken out, so net savings are honest.
- **Failure scoreboard:** empties/refusals/timeouts/malformed/repairs per arm.
- **Judge reliability:** inter-judge κ + flagged disagreements.
- **Per-category verdict vs the §2 gates:** PASS (go-pilot win) / FAIL (keep on Opus).
- **Honesty section:** single-campaign sample size, Max-plan pricing assumptions,
  reasoning-token cost, what would be needed for a production-grade claim.

---

## 11. Execution flow (single pass, resumable)

```
Phase 0  connectivity + spend tracking                      ✓ DONE
Phase 1  config: ikey-hybrid profile + real model IDs + `config doctor` green
Phase 2  freeze manifest (28 tasks, hashed) + grader (deterministic + dual-judge + anchors)
Phase 3  smoke gate: 1 task each through Opus (Claude CLI headless), Kimi, DeepSeek  [go/no-go]
Phase 4  run A/B/C × 28 tasks × 3 trials, randomized order, budget-guarded, checkpointed
Phase 5  grade (deterministic + blind dual-judge) + judge-agreement
Phase 6  aggregate (medians, p75/p95, bootstrap CIs) + write results report
```

No loops back into design; a rate-limit pause resumes at the last checkpoint.

---

## 11.1 Execution model — how it actually runs (NOT herdr/Pi panes)

This tests the **real governed coordinator** (`runTask` / `gopilot run`) — routing,
context compression/tiering, budgets, validation, journal, and metrics are the
genuine production path. Only the dispatch *leaf* transport is chosen for exact
accounting:

- **Opus (frontier):** the **real Claude CLI** headless — `claude -p --model opus
  --output-format json` — i.e. authentic Max-plan usage exactly as a frontier
  worker runs. **Low reasoning effort** is pinned on every benchmark Opus call
  (per user), applied consistently to Arm A orchestration, Arm B, and judging,
  and disclosed in the report. Each fresh CLI call carries the **~49k Claude-Code
  system-prompt overhead (D32)** (verified: a trivial call reported ~49k
  cache-creation tokens ≈ $0.50 at Opus API rates); this fixed per-call tax is
  captured in cost accounting and is itself part of why go-pilot routes cheap
  subtasks *off* Opus.
- **Workhorse (Kimi/DeepSeek):** the coordinator's workhorse dispatch calls the
  Ikey gateway **directly over its OpenAI-compatible HTTP API** (zero-dep fetch),
  not through Pi. Pi is itself just a client that POSTs to the same endpoint — so
  the governed pipeline is identical; calling directly gives **exact per-call
  `usage`** and precise **`/key/info.spend` deltas** for cost, which the benchmark
  requires.
- **NOT herdr panes:** the S10 coordinator spawns dispatch adapters directly; it
  does not use the herdr pane substrate. So "opening herdr+Pi and running like a
  user" is not how `gopilot run` executes today — the coordinator IS the user path.
- **NOT Pi's agentic tool loop (this proof):** a live tool-using agent loop adds
  large, non-deterministic token variance and budget risk. For a clean
  token-efficiency proof every arm is uniform **text-in → text-out**. **Area 7
  (repo-change)** is therefore tested as **patch generation**: the model emits a
  unified diff / file edits as text; the harness **applies it to a throwaway git
  fixture and runs the tests** (deterministic grading) — measuring coding-agent
  *output quality* without the variance of a live agent loop.
- **A full herdr+Pi agentic run is a SEPARATE, later test** — it measures the
  agent loop's task-completion, a different question from this campaign's
  token-efficiency-of-governed-routing.

## 12. Risks / open items

- **Reasoning-token cost & empty output:** generous `max_tokens`; empties counted
  as failures (§7).
- **Claude CLI headless (Opus):** confirm `scripts/lean-worker.sh` drives Opus 4.8
  non-interactively (Phase 3 smoke). If not, the Opus arm needs an alternate path.
- **Max-plan usage limits:** Opus runs Arm A orchestration + all of Arm B + all
  primary judging → heavy. Serialize + backoff + checkpoint/resume; trial count is
  the first knob to reduce.
- **Judge self-preference:** mitigated by blind + independent co-judge + κ report;
  residual bias disclosed.
- **Per-model $ attribution:** single key → total spend; per-model via serial
  spend-delta attribution.
- **Sample size:** 28×3 is directional; the report states confidence honestly.

---

## 13. Before I execute — confirmations

1. **Approve v2** (or adjust areas / routing / thresholds / trial count).
2. **Confirm Opus = your Claude CLI Max plan** + headless `claude` works (Phase 3 smoke).
3. **Approve caps:** Kimi $5, DeepSeek $2, $7 total (expected actual: cents).

On "go" I run Phases 1→6 in one resumable pass and hand back
`docs/live-test-results.md`.
