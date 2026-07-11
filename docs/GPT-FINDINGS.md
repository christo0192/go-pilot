# GPT Production-Readiness Findings

**Review date:** 2026-07-10  
**Review type:** Read-only architecture, implementation, test, security, and operations review  
**Current recommendation:** Experimental beta for a single trusted operator; not production-ready

## Executive Summary

Go-pilot is a well-considered prototype built around a credible premise: reduce agent token consumption and improve throughput by combining deterministic routing, lean worker contexts, context compression, cheaper workhorse models, validation-gated memory, and task-class-specific multi-agent execution.

The architecture generally supports that purpose. In particular, deterministic routing, Reference > Compressed > Full context transfer, scoped worker tools, frontier/workhorse separation, and safe fallback to a single agent are appropriate design choices.

However, the repository does not yet contain a complete production control plane that automatically composes and enforces these mechanisms. Several important paths remain manual or unverified, including the live Pi-to-LiteLLM workhorse flow and representative per-task-class acceptance runs. As a result, the project has not yet demonstrated that the complete system achieves its stated token-reduction target without unacceptable quality loss.

## Readiness Assessment

| Area | Assessment | Notes |
| --- | --- | --- |
| Architecture | 7/10 | Strong concepts and modular boundaries; incomplete end-to-end composition |
| Component implementation | 7/10 | Small, readable, dependency-light modules with useful unit coverage |
| Token-efficiency design | 7/10 | Good mechanisms, but savings are not yet proven across representative workloads |
| Reliability | 5/10 | Safe defaults exist, but state transitions, recovery, and integrated failure handling need work |
| Security | 4/10 | Suitable for localhost development; not hardened for shared or production deployment |
| Operations | 4/10 | Installers and Compose exist, but deployment is mutable and production observability is limited |
| Production readiness | 4/10 | Appropriate for a controlled pilot, not production use |

## Strengths

### Architecture

- Deterministic routing avoids unnecessary model-based routing calls for known task classes.
- Separating frontier and workhorse planes allows expensive judgment work to remain on capable models while bulk work moves to cheaper models.
- Reference-first context transfer directly addresses repeated-context token waste.
- Per-worker tool profiles reduce tool-schema context and unnecessary capabilities.
- Bounded tool-call repair is an appropriate reliability layer for weaker open models.
- Validation-before-compression and validation-before-memory promotion protect against turning failed work into misleading summaries.
- The default-to-single-agent policy for unvalidated task classes is a sound safety mechanism.
- Native Claude and Codex authentication avoids routing subscription credentials through an unofficial proxy.

### Implementation

- Core modules are small, focused, and generally deterministic.
- The project has very few runtime dependencies and uses standard Node.js ESM.
- Router, boundary, memory, metrics, TOON, repair, and communication mechanisms are independently testable.
- The plan explicitly recognizes that multi-agent fan-out can consume more tokens on small tasks.
- Router overhead is at least represented as a separate accounting line rather than silently subtracted from savings.

## Production Gaps and Recommended Fixes

### P0 — Complete the Integrated Control Plane

**Finding:** The repository provides individual primitives but no primary executable that composes the full workflow. The documented orchestration path still depends on manual Herdr commands and shell wrappers.

**Risk:** Important policies can be bypassed or applied inconsistently. Unit-tested mechanisms do not guarantee that real agent runs use routing, boundary enforcement, validation, memory, and metrics correctly.

**Recommended fix:**

1. Add a supported orchestration command, for example `gopilot run <task>`.
2. Make the command own the complete lifecycle:
   - classify or accept the task class;
   - load the active profile;
   - enforce per-class sign-off;
   - route to a plane and model;
   - select the worker tool profile;
   - create or select an isolated worktree;
   - dispatch through Herdr;
   - collect output and actual usage;
   - validate the result;
   - apply boundary policy;
   - promote approved memory;
   - persist metrics and the final verdict.
3. Treat all lower-level modules as internal libraries used by this command.
4. Add a dry-run mode that prints the route, model, tools, context tier, and expected dispatch without invoking a model.

**Done when:** A single command runs a task end-to-end and an integration test proves that every required policy is invoked.

### P0 — Prove the Main Token-Efficiency Claim

**Finding:** Representative per-task-class acceptance runs are still pending. Existing results demonstrate mechanisms and isolated compression, not the net economics of the complete system.

**Risk:** Routing, context preparation, retries, summarization, and worker coordination may consume more tokens than they save.

**Recommended fix:**

1. Define a stable benchmark suite for each supported task class.
2. Include small, medium, and large tasks from real repositories.
3. Compare at least:
   - single frontier agent;
   - pure-anthropic multi-agent;
   - hybrid multi-agent;
   - open-first, where applicable.
4. Repeat each case enough times to account for model variability.
5. Record actual input, output, cached, reasoning, routing, repair, retry, and summarization tokens.
6. Record latency, monetary cost, success rate, and human-scored quality.
7. Publish break-even thresholds showing when fan-out should and should not occur.
8. Keep any class without sufficient passing evidence on the single-agent path.

**Done when:** Every enabled multi-agent task class meets the configured token-reduction and quality targets on representative repeated trials.

### P0 — Finish the Live Workhorse Path

**Finding:** `scripts/pi-gopilot.sh` currently launches Pi against OpenAI and `gpt-4o-mini`. The documented Pi → LiteLLM → open-model path remains incomplete.

**Risk:** The hybrid profile's primary cost-saving path is not operational or validated.

**Recommended fix:**

1. Configure Pi to use `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY` by default for hybrid/open-first profiles.
2. Resolve the routed model alias dynamically rather than hard-coding a model.
3. Fail closed when a selected model is inactive or lacks credentials.
4. Add provider capability checks for tools, JSON schema, context size, and streaming.
5. Complete constrained-decoding validation where providers support it.
6. Measure tool-call validity before and after repair on real workhorse models.

**Done when:** A real task completes through Pi, LiteLLM, a configured provider, tool validation, repair, and metrics collection.

### P0 — Correct Metrics and Acceptance Accounting

**Finding:** Aggregate acceptance averages per-run percentages equally. Small and large tasks therefore have the same influence. Router judgment cost uses a fixed 1,500-token estimate rather than actual usage.

**Risk:** The acceptance report can show a pass while total tokens, cost, or representative workload performance fails the target.

**Recommended fix:**

1. Compute portfolio token reduction from aggregate totals:
   - `(sum(singleTokens) - sum(multiTokens)) / sum(singleTokens)`.
2. Retain per-run and per-class distributions rather than relying only on averages.
3. Report median, p90, standard deviation or confidence interval, and sample count.
4. Capture actual router usage from provider or CLI responses.
5. Include repair prompts, retries, failed calls, context retrieval, memory operations, and summarization in total usage.
6. Add explicit latency and monetary-cost acceptance targets.
7. Version the benchmark, rubric, model configuration, and prompts used for each result.

**Done when:** Reports reconcile to provider/CLI usage totals and cannot pass through unweighted percentage distortion.

**Resolution (Step 8.4 — partial):** Aggregation is now portfolio-weighted, not
equal-average, in both the acceptance gate and per-class sign-off.

- `src/metrics/acceptance.mjs::evaluate` computes the headline
  `tokenReductionPct` from aggregate totals `(Σ single − Σ multi) / Σ single`,
  and a size-weighted quality drop (weight = each run's single-agent tokens).
  This portfolio number is the pass/fail gate; the equal-weight mean is retained
  under `aggregate.mean*` for transparency only. Fixes rec. #1.
- `src/metrics/stats.mjs` adds pure `median` / `p90` / `stdev` / `weightedMean`
  helpers, and `evaluate` now returns a `distribution` (median, p90, stdev,
  sampleCount) for both metrics; `formatReport` renders it and labels the gate.
  `signoff.mjs` uses the same weighting. Fixes rec. #2–#3.
- Router judgment cost can now carry **actual** tokens:
  `src/router/judgment-log.mjs::logJudgment` accepts `actualTokens` and records
  it with a `tokenSource` label (`actual` → `estimate` → `fallback-estimate`);
  the 1,500 constant survives only as the labeled `FALLBACK_ESTIMATED_TOKENS`.
  `src/router/overhead-report.mjs::summarizeOverhead` sums actuals when present
  (`totalActualTokens` / `actualCount`) and prefers them over the estimate.
  Partially addresses rec. #4.
- Still open: recs. #5–#7 (full-usage capture incl. repair/retrieval/memory,
  latency + monetary targets, benchmark/prompt versioning).

### P0 — Add Full End-to-End Tests

**Finding:** The current suite primarily tests isolated modules. The memory integration test does not cover the complete orchestration pipeline.

**Observed validation result:** In this review environment, `node --test` reported 21 test files: 18 passed and 3 failed. Mesh and Mem0 client tests were blocked by the environment's restriction on localhost listeners. RTK fallback assertions also failed because nested raw commands returned empty output. The advertised `172/172` result was therefore not reproducible here.

**Risk:** Integration mismatches, environment assumptions, and policy bypasses can reach users despite passing unit tests.

**Recommended fix:**

1. Add an in-process fake dispatcher and fake model provider.
2. Test the complete lifecycle without requiring network ports or external CLIs.
3. Add an optional live integration suite for Herdr, Claude, Codex, Pi, LiteLLM, Mem0, CCE, and RTK.
4. Separate test scripts into `test:unit`, `test:integration`, and `test:live`.
5. Make live tests explicitly skip with reasons when dependencies are unavailable.
6. Add failure injection for provider timeout, invalid tool call, worker crash, stale claim, Mem0 outage, CCE outage, and partial output.
7. Run the portable suite on Linux, WSL, Windows, and macOS CI or clean-machine runners.

**Done when:** The portable suite is deterministic and the live suite proves the supported production topology.

### P1 — Strengthen Task-Store Correctness

**Finding:** A task can be claimed without checking that it is pending and dependency-ready. Completion does not verify that the task was claimed or that the completing worker owns the claim. Claim files have no lease or recovery mechanism.

**Risk:** Workers can execute blocked tasks, unauthorized workers can complete tasks, and crashes can leave tasks permanently claimed.

**Recommended fix:**

1. Enforce a state machine such as `pending → claimed → validating → done|failed`.
2. Permit claims only when all dependencies are complete.
3. Require a claim token or worker identity for completion.
4. Write state atomically using temporary files plus rename.
5. Add leases, heartbeats, expiry, and stale-claim recovery.
6. Store failure state and retry count explicitly.
7. Add schema/version validation and corruption recovery.
8. Consider SQLite with transactions if concurrency grows beyond a small local rig.

**Done when:** Invalid transitions are rejected and crash-recovery tests demonstrate that work cannot remain permanently stranded.

### P1 — Make Context Enforcement Token-Aware

**Finding:** Boundary limits are character-based, not model-token-based. The fallback compressor truncates the beginning of raw output and may discard the final error summary or stack trace.

**Risk:** Context budgets may be exceeded for some content, while important diagnostic information may be lost.

**Recommended fix:**

1. Enforce limits in estimated or provider-reported tokens for the selected model.
2. Define payload schemas for reference, compressed, and full tiers.
3. Preserve structured signals such as command, exit code, failing test, file, line, first error, and final error.
4. Use head-and-tail truncation for unstructured logs.
5. Store the complete output as an artifact and pass a reference to it.
6. Require structured justification codes for full-content exceptions.
7. Log every downgrade, exception, compression ratio, and retrieval fallback.

**Done when:** Boundary enforcement remains within the selected model's budget while preserving actionable failure information.

### P1 — Harden Local Networking and IPC

**Finding:** The mesh uses unauthenticated newline-delimited JSON over localhost TCP. It does not enforce message-size, connection, or concurrency limits.

**Risk:** Another local process can impersonate a peer, inject queries, consume resources, or send oversized messages.

**Recommended fix:**

1. Prefer Unix domain sockets or named pipes with filesystem permissions where possible.
2. Otherwise use per-run authentication tokens and validate sender/recipient identities.
3. Add maximum message and buffer sizes.
4. Add connection, request, and concurrency limits.
5. Validate message schemas and reject unknown fields/types.
6. Add correlation IDs, audit records, and replay protection.
7. Return bounded, sanitized errors rather than internal exception text.

**Done when:** Unauthorized peers and oversized messages are rejected in automated tests.

### P1 — Harden Deployment

**Finding:** The Compose configuration is development-oriented: services bind to host interfaces, Mem0 authentication defaults to disabled, development secrets are provided, LiteLLM uses a floating image tag, and Mem0 installs a package during every startup.

**Risk:** Shared-machine exposure, non-reproducible deployments, supply-chain drift, slow or failed restarts, and accidental use of weak credentials.

**Recommended fix:**

1. Bind local-only services explicitly to `127.0.0.1` unless remote access is required.
2. Remove production defaults for passwords and master keys; fail startup when secure values are absent.
3. Enable Mem0 authentication in production profiles.
4. Pin container images by version and preferably digest.
5. Build a reproducible Mem0 image with all dependencies installed at build time.
6. Pin the Mem0 source revision rather than cloning the latest default branch.
7. Add a Mem0 health check and readiness checks that verify dependencies, not only process liveness.
8. Add resource limits, log rotation, backup/restore instructions, and migration rollback procedures.
9. Split development and production Compose overrides.
10. Add dependency and container vulnerability scanning.

**Done when:** A clean, pinned deployment passes a security checklist and can be backed up, restored, upgraded, and rolled back.

### P1 — Improve Reliability and Recovery

**Finding:** The design includes component fallbacks but lacks a unified run state, cancellation model, idempotency contract, and restart recovery procedure.

**Risk:** Interrupted runs can leave panes, worktrees, claims, partial metrics, or memory state inconsistent.

**Recommended fix:**

1. Assign every run and task a durable unique ID.
2. Persist lifecycle events and state transitions.
3. Make dispatch and completion idempotent.
4. Define cancellation and timeout behavior for every external operation.
5. Clean up panes and worktrees through a finally/recovery path.
6. Reconcile incomplete work on startup.
7. Introduce bounded retries with exponential backoff and jitter.
8. Add circuit breakers for failing providers and services.

**Done when:** Killing the orchestrator during each lifecycle stage can be recovered without duplicated or lost work.

### P1 — Add Production Observability

**Finding:** Metrics focus on acceptance experiments, not ongoing production operation.

**Risk:** Token regressions, provider degradation, retry storms, memory failures, and cost increases may go unnoticed.

**Recommended fix:**

1. Emit structured JSON events for runs, tasks, routes, model calls, retries, validations, context transitions, and memory operations.
2. Track tokens, cost, latency, time-to-first-token, success rate, retry rate, repair rate, queue time, and compression ratio.
3. Track results by task class, profile, model, provider, prompt version, and project.
4. Add privacy-aware redaction before logging prompts or outputs.
5. Define alerts or visible warnings for budget, retry, failure, and quality regressions.
6. Provide a local run-inspection command and a summary dashboard or report.

**Done when:** A failed or expensive run can be diagnosed from its run ID without reconstructing terminal history.

### P2 — Improve Configuration and Model Governance

**Finding:** Model aliases and provider slugs can drift, and router configuration validation is limited.

**Risk:** A provider change can silently break routing or change cost, quality, or context behavior.

**Recommended fix:**

1. Define and validate a typed configuration schema at startup.
2. Verify that every routed model alias exists and is active.
3. Maintain capability metadata for tools, structured output, context size, cost, and data policy.
4. Pin or explicitly approve model-version changes.
5. Add a configuration doctor command that checks binaries, credentials, services, aliases, and supported features.
6. Record the resolved model and provider for every run.

**Done when:** Invalid or incomplete profiles fail before dispatch and model changes are visible and auditable.

### P2 — Complete Cross-Platform Acceptance

**Finding:** Fresh-machine Windows and macOS verification and visible-pane UX remain incomplete.

**Risk:** Installation, path handling, process management, locking, sockets, and shell behavior may differ across supported systems.

**Recommended fix:**

1. Test from clean Windows, WSL2, macOS Intel, and macOS Apple Silicon environments as applicable.
2. Verify install, upgrade, uninstall, Compose, Herdr, Pi, Claude, Codex, CCE, RTK, worktrees, and locks.
3. Record exact supported versions and known limitations.
4. Add smoke-test scripts that users can run after installation.
5. Treat an environment as supported only after its acceptance checklist passes.

**Done when:** The documented quickstart succeeds unmodified on every supported environment.

## Recommended Production Architecture

The existing modular design can be retained. The missing element is a durable coordinator around it.

```text
CLI / TUI
   |
Run Coordinator
   |-- Profile and configuration validation
   |-- Task classification and per-class sign-off gate
   |-- Deterministic router
   |-- Context-budget and boundary manager
   |-- Durable task/state store
   |-- Dispatcher adapters
   |     |-- Herdr + Claude
   |     |-- Herdr + Codex
   |     `-- Herdr + Pi + LiteLLM
   |-- Tool-call validation and repair
   |-- Result validation
   |-- Memory promotion and recall
   `-- Usage, quality, cost, and audit events
```

The coordinator should be the only supported route into production execution. Shell helpers and individual modules should remain useful for diagnostics, but should not be relied upon to enforce system invariants.

## Production Roadmap

### Phase 1 — Establish a Real End-to-End Path

- Build the run coordinator and dispatcher interfaces.
- Wire one frontier model and one workhorse model through the complete lifecycle.
- Add portable fake-provider end-to-end tests.
- Capture actual usage and run state.
- Enforce single-agent fallback for every unsigned class.

**Exit criterion:** One command completes and records a fully governed run.

### Phase 2 — Validate the Product Hypothesis

- Build representative task-class benchmarks.
- Run repeated single-agent and multi-agent comparisons.
- Correct metrics aggregation and include all overhead.
- Determine task-size and complexity break-even rules.
- Sign off only the classes that pass.

**Exit criterion:** The enabled routing policy is supported by reproducible evidence.

### Phase 3 — Reliability and Security Hardening

- Implement durable state transitions, leases, recovery, and idempotency.
- Harden IPC, secrets, authentication, containers, and dependency pinning.
- Add timeouts, cancellation, backoff, circuit breakers, and cleanup.
- Add backup, restore, upgrade, and rollback procedures.

**Exit criterion:** Failure injection and security checks pass without lost or duplicated work.

### Phase 4 — Operational Readiness

- Add structured observability and run inspection.
- Complete clean-machine cross-platform verification.
- Define support boundaries and operating procedures.
- Run a limited pilot on real projects and monitor regressions.

**Exit criterion:** A trusted pilot runs successfully for a defined observation period with stable quality, cost, and reliability.

### Phase 5 — Production Release

- Freeze and version the first supported configuration.
- Publish benchmark and acceptance results.
- Document incident response, rollback, data retention, and privacy behavior.
- Require the go-live checklist below for release.

## Go-Live Checklist

- [ ] A single supported command enforces the complete workflow.
- [ ] Hybrid Pi → LiteLLM → provider execution is live and measured.
- [ ] Every enabled multi-agent class has representative passing evidence.
- [ ] All token, retry, repair, routing, and summarization overhead is included.
- [ ] Aggregate metrics use workload-weighted totals and show distributions.
- [ ] Portable unit and end-to-end tests pass consistently.
- [ ] Live integration tests pass on the supported topology.
- [ ] Task claims, transitions, leases, recovery, and idempotency are enforced.
- [ ] Context boundaries are token-aware and preserve failure signals.
- [ ] IPC is authenticated, bounded, validated, and auditable.
- [ ] Containers, source revisions, and model versions are pinned.
- [ ] Production secrets have no development defaults.
- [ ] Mem0 and LiteLLM are not exposed beyond their intended network boundary.
- [ ] Backups, restore, migrations, upgrades, and rollback are tested.
- [ ] Structured logs and operational metrics are available by run ID.
- [ ] Windows, WSL2, and macOS acceptance is complete for claimed platforms.
- [ ] A controlled pilot meets defined reliability, quality, token, cost, and latency targets.

## Final Recommendation

Continue with the current architecture rather than rewriting the project. Its main concepts are aligned with the goal of reducing token use and improving agent throughput. Focus the next development cycle on integration and measurement instead of adding more standalone mechanisms.

The most important next milestone is not another optimization feature. It is a complete, automatically enforced run path accompanied by representative evidence that the total system—including orchestration and retries—uses fewer tokens while maintaining acceptable quality.
