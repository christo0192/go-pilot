# Go-pilot Competitor Performance and 9/10 Production Plan

**Document date:** 2026-07-11  
**Document purpose:** Research synthesis and implementation plan only  
**Execution status:** No implementation authorized by this document  
**Target:** Raise every assessment category to at least 9/10, with 10/10 as the stretch objective

## Implementation Status — 2026-07-12

The first build pass implemented the load-bearing local runtime pieces:

- Real `gopilot run` process adapters for Claude, Codex, and Pi/workhorse execution.
- Enforced execution contracts and hard input/output/turn/tool/retry/retrieval budgets.
- Operational `single-agent`, `plan-only`, `plan-then-execute`, `retrieval-only`, and candidate/multi-agent strategies.
- Fail-closed ambiguous routing and model governance.
- Stable prompt sections with cache fingerprints and cache-token metadata.
- Bounded parallelizable repository retrieval with ranked references.
- Full-prompt budget allocation that reserves user intent before context.
- Mandatory category validation checks before success or memory promotion.
- Durable idempotent dispatch, retry/backoff, circuit breaking, and unique run IDs.
- Structured event emission and persistent CLI event/metrics logs.
- Scoped `AGENTS.md`/`.gopilot-rules.md` discovery.
- Workspace before/after checkpoints and diff evidence.
- Benchmark runner foundation and expanded hermetic tests.

Still externally or operationally gated:

- Live provider credential verification for every configured model.
- True provider prompt-cache control where the CLI/gateway exposes it.
- Production semantic/symbol index beyond the bounded lexical retrieval foundation.
- Automated worktree creation, merge/revert UX, and remote handoff.
- Full benchmark corpus, repeated per-class campaign, grader calibration, and routing calibration.
- Cross-platform clean-machine acceptance, security review, soak/chaos tests, and controlled pilot.

The roadmap below remains the release specification. Items are complete only when their acceptance evidence exists, not merely because a supporting module has been added.

## Executive Summary

Go-pilot has advanced from an early prototype into a strong pre-production foundation. Its architecture already incorporates several techniques used by leading coding-agent products: deterministic routing, specialized models, scoped tool profiles, context compression, semantic retrieval, worktree isolation, durable memory, validation gates, repair loops, observability primitives, and model governance.

The remaining difference between Go-pilot and mature products such as Windsurf, Cursor, Claude, and Codex is primarily operational integration and optimization maturity. Commercial systems do not rely on one optimization. They combine codebase indexing, dynamic retrieval, scoped instructions, prompt caching, execution modes, checkpoints, constrained tools, validation loops, feedback learning, continuous evaluation, and production telemetry into one unavoidable runtime path.

Their general operating loop is:

```text
Index → Retrieve → Plan → Act → Observe → Validate → Repair → Evaluate → Learn
```

Go-pilot currently approximates:

```text
Route → Compress → Dispatch → Validate → Remember
```

The goal of this plan is to preserve Go-pilot's terminal-native, provider-independent architecture while adding the retrieval, caching, enforcement, evaluation, and operational capabilities needed to meet or exceed industry standards.

## Current Assessment

| Category | Current | Previous | Primary reason score is not yet 9/10 |
| --- | ---: | ---: | --- |
| Architecture | 8/10 | 7/10 | Strong modules, but incomplete live runtime composition and retrieval architecture |
| Component implementation | 8/10 | 7/10 | Good isolated components, but several are not enforced in the coordinator |
| Reliability foundation | 7/10 | 5/10 | Strong primitives exist; live dispatch, recovery, cleanup, and failure injection remain incomplete |
| Security foundation | 6.5/10 | 4/10 | Hardened IPC and deployment improvements exist; full production security validation is pending |
| Production readiness | 5.5/10 | 4/10 | Supported CLI is dry-run only; no controlled production pilot or cross-platform acceptance |
| Token-efficiency proof | 3/10 | 3/10 | Live representative benchmark campaign is still pending |

## Target Assessment

### Minimum Release Target

Every category must reach **9/10 or higher** before Go-pilot is presented as production-ready.

| Category | Minimum target | Stretch target |
| --- | ---: | ---: |
| Architecture | 9/10 | 10/10 |
| Component implementation | 9/10 | 10/10 |
| Reliability foundation | 9/10 | 10/10 |
| Security foundation | 9/10 | 10/10 |
| Production readiness | 9/10 | 10/10 |
| Token-efficiency proof | 9/10 | 10/10 |

### Meaning of 9/10

A 9/10 score means:

- The capability is implemented in the supported runtime, not only as a standalone module.
- Tests cover normal operation, boundary cases, and representative failures.
- Behavior is observable and measurable.
- Production defaults fail safely.
- Documentation matches actual behavior.
- Evidence exists from real workloads and supported environments.
- Known residual risks are limited, documented, and operationally manageable.

### Meaning of 10/10

A 10/10 score is a stretch target. It requires everything needed for 9/10 plus:

- Repeated evidence across varied repositories and operating systems.
- Automated regression detection for quality, token use, cost, and latency.
- Mature incident response, rollback, and recovery procedures.
- Self-tuning or evidence-generated routing and budgeting policies.
- Strong operator experience with clear review, diagnosis, and control surfaces.
- No known high-severity design or operational gaps.

## Official Competitor Research

Only official product documentation was used for the main technical comparisons below.

## Windsurf

### Techniques Used

Windsurf uses a RAG-based context engine that indexes the codebase and retrieves relevant code instead of placing the entire repository into the model context. Its standard context can include open files, indexed local code, relevant snippets, user activity, and inferred intent. This is intended to improve output quality and reduce hallucination by providing targeted state context. [Windsurf context-awareness overview](https://docs.windsurf.com/de/context-awareness/overview)

Windsurf's Fast Context system delegates code retrieval to a specialized subagent using retrieval-focused SWE-grep models. The documented design includes:

- Parallel retrieval calls.
- A restricted cross-platform tool set of `grep`, `read`, and `glob`.
- Multiple retrieval rounds.
- Targeted code results returned to the main agent.
- Protection of the main model's context budget from irrelevant exploration.

[Windsurf Fast Context](https://docs.windsurf.com/ro/context-awareness/fast-context)

Cascade also provides:

- Separate Code and Chat modes.
- An integrated planning agent for longer work.
- Plans and task lists.
- Named checkpoints and revert support.
- Real-time awareness of editor activity.
- Linter integration.
- Parallel Cascade sessions.
- Web and documentation retrieval.
- MCP tools.
- Memories, rules, workflows, and skills.

[Windsurf Cascade](https://docs.windsurf.com/pt-BR/windsurf/cascade/cascade)

Windsurf distinguishes durable knowledge surfaces by purpose:

- Rules for behavioral constraints.
- `AGENTS.md` for location-scoped repository instructions.
- Workflows for manually invoked repeatable sequences.
- Skills for dynamically invoked procedures with supporting resources.
- Memories for automatically retrieved session knowledge.

Skills use progressive disclosure: only the name and description are initially visible, while complete instructions and resources load only after invocation. [Windsurf Skills](https://docs.windsurf.com/de/windsurf/cascade/skills), [Windsurf Memories and Rules](https://docs.windsurf.com/fr/windsurf/cascade/memories)

### Lessons for Go-pilot

- Retrieval should be a specialized plane, not incidental tool use by the main worker.
- Retrieval must use constrained tools and bounded rounds.
- Planning and short-term execution should be separate roles.
- Checkpoints and reverts should be runtime features.
- Durable rules, workflows, skills, and probabilistic memory should remain distinct.
- Context should be progressively disclosed rather than broadly loaded and truncated.

## Cursor

### Techniques Used

Cursor automatically indexes a project and retrieves relevant context. Its context system can incorporate current files, semantically similar code, session information, explicit files and folders, symbols, documentation, git history, past chats, recent changes, lint errors, and definitions. [Cursor working with context](https://docs.cursor.com/en/guides/working-with-context), [Cursor context references](https://docs.cursor.com/context/%40-symbols/overview)

Cursor manages large context through:

- Automatic conversation summarization.
- Structural file and folder condensation.
- Exposure of function signatures, classes, and methods before full bodies.
- Selective expansion of relevant files.
- Clear indication when content is significantly condensed or omitted.

[Cursor summarization](https://docs.cursor.com/en/agent/chat/summarization)

Cursor rules can be:

- Always active.
- Automatically attached through path patterns.
- Selected by the agent based on relevance.
- Manually invoked.
- Nested and directory-specific.

[Cursor rules](https://docs.cursor.com/context/rules-for-ai)

Cursor also exposes different operating surfaces for different workloads:

- Tab completion for small local changes.
- Inline Edit for focused edits.
- Ask mode for analysis and planning.
- Agent mode for multi-step implementation.
- Custom modes with selected models, tools, and instructions.
- Background agents operating in isolated remote branches.
- Automatic checkpoints and diff review.

[Cursor Agent overview](https://docs.cursor.com/chat/overview), [Cursor background agents](https://docs.cursor.com/background-agent)

Cursor documents that different models should be selected according to task complexity, reasoning requirements, context size, initiative, cost, and latency. [Cursor model selection](https://docs.cursor.com/guides/selecting-models)

### Lessons for Go-pilot

- Add symbol- and structure-aware context rather than relying mainly on text chunks.
- Expose which context was included, condensed, expanded, or omitted.
- Add explicit modes with different model/tool/budget policies.
- Keep instructions scoped to the nearest relevant directory.
- Add an operator-facing diff and checkpoint review experience.
- Include active editor/change/error state when an IDE adapter is available.

## Claude

### Techniques Used

Anthropic prompt caching allows stable prompt prefixes to be reused across requests. Cacheable content can include tool definitions, system messages, messages, documents, images, and tool results. Stable cached prefixes can reduce latency, input cost, and rate-limit consumption. [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

Anthropic recommends placing stable content before dynamic request content:

```text
stable tools
stable system instructions
stable project context and examples
stable conversation prefix
dynamic task context
current request
```

Tool-definition changes can invalidate the downstream cache. Anthropic therefore supports deferred tool loading so an agent can begin with a small cached tool set and discover additional tools only when needed. [Anthropic tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)

Claude also supports:

- Explicit tool allowlists and denylists.
- Maximum-turn limits.
- Machine-readable JSON and streaming output.
- Resumable sessions.
- On-demand skills that affect context only when invoked.
- Persistent memory stores.
- LLM gateway integration for authentication, usage tracking, cost controls, audit logging, and model routing.

[Claude CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage), [Claude Skills](https://platform.claude.com/docs/en/managed-agents/skills), [Claude memory](https://platform.claude.com/docs/en/managed-agents/memory), [Claude LLM gateway](https://docs.anthropic.com/en/docs/claude-code/llm-gateway)

### Lessons for Go-pilot

- Prompt caching must become a first-class metric and optimization layer.
- Prompt section ordering and stability should be intentionally designed.
- Tool profiles should support deferred loading, not only static selection.
- Cache invalidation should be observable.
- Maximum turns and explicit tool policies should be part of every execution contract.
- Gateway usage, budgets, and audit information should be reconciled into run metrics.

## Codex

### Techniques Used

Codex separates customization by responsibility:

- `AGENTS.md` for small, durable repository guidance.
- Memory for useful learned context.
- Skills for reusable workflows and domain expertise.
- MCP for external tools and shared systems.
- Subagents for specialized delegated work.

OpenAI recommends keeping repository instructions small, placing them in the closest relevant directory, adding retrieval guidance when the agent reads too much, and converting repeated review corrections into durable guidance. [Codex customization](https://developers.openai.com/codex/concepts/customization)

Codex also provides or documents:

- Local sandboxing and approvals.
- Worktree and cloud-environment isolation.
- Plan and execution modes.
- Specialized subagents.
- Skills and MCP integrations.
- Hooks for mechanical policy enforcement.
- Non-interactive execution.
- Local and cloud handoff.
- Long-running task support.
- Code-review workflows.
- Compaction for extended context.
- Parallel or alternative work attempts.

### Lessons for Go-pilot

- Durable instructions should remain concise and geographically scoped.
- Repeated agent mistakes should feed a controlled rules-update process.
- Mechanical guarantees belong in hooks or coordinator policy, not prompts alone.
- Local and remote execution should share the same run contract and trace format.
- Long-running work requires resumability, handoff, compaction, and durable state.
- Multiple candidate attempts should be available for difficult, automatically verifiable tasks.

## Competitive Capability Matrix

| Capability | Windsurf | Cursor | Claude | Codex | Go-pilot today | Required state |
| --- | --- | --- | --- | --- | --- | --- |
| Codebase indexing | RAG index | Automatic index | Agent exploration/memory | Agent exploration/tools | CCE pilot | Production hybrid index |
| Specialized retrieval | Fast Context subagent | Semantic codebase retrieval | Tool-driven retrieval | Tool/subagent retrieval | No dedicated retrieval plane | Dedicated bounded retrieval agent |
| Parallel retrieval | Yes | Automatic | Tool/agent dependent | Subagent/tool dependent | Possible but not enforced | Parallel retrieval policy |
| Structural condensation | Targeted snippets | Symbols/signatures/condensation | Prompt/context tooling | Compaction/tools | Token-aware text boundary | Symbol-aware progressive expansion |
| Prompt caching | Product-managed | Product-managed | Explicit API caching | Provider/runtime managed | Missing | Provider-aware cache layer |
| Deferred tool loading | Skills/tools | Mode/rule/tool selection | Tool search/deferred tools | Skills/MCP/tool loading | Static tool profiles | Dynamic tool discovery |
| Scoped instructions | Rules/`AGENTS.md` | Nested rules | Project instructions/skills | Nested `AGENTS.md` | Prompt fragment/Pi resources | Unified scoped rule engine |
| Execution modes | Code/Chat/plan | Ask/Agent/Inline/custom | Plan, print, permissions | Plan/execution/review | Metadata-only modes | Enforced strategies |
| Planner separation | Planning agent | Ask/planning workflow | Subagents/planning | Plan mode/subagents | Router roles | Planner/executor/reviewer state machine |
| Checkpoints | Named checkpoints | Automatic checkpoints | Git/worktree dependent | Worktrees/cloud handoff | Worktrees | Durable run checkpoints and restore |
| Validation loop | Linter/error integration | Auto-fix and terminal | Tests/tools/hooks | Tests/review/hooks | Gate and repair modules | Mandatory validation contracts |
| Durable execution | Conversation/task state | Background agents | Resumable sessions | Long-running/cloud tasks | Journal primitives | Fully integrated resumable runtime |
| Memory | Memories/rules | Memories/past chats | Memory stores | Memory/customization | Tier-1 + Mem0 | Typed memory and promotion governance |
| Feedback learning | Rules/memories | Generated rules | Skills/memory | `AGENTS.md` feedback loop | Memory promotion | Verified feedback-to-rule pipeline |
| Model selection | User/model tiers | Auto/manual modes | Aliases/gateway | Model/reasoning settings | Deterministic categories | Benchmark-calibrated routing |
| Observability | Product telemetry | Product telemetry | Gateway/usage data | Traces/analytics | Event module | End-to-end live telemetry |
| Candidate comparison | Parallel Cascades | Background agents | Multiple agents possible | Parallel/cloud attempts | Not enforced | Selective candidate racing |
| Evaluation | Internal product evals | Internal product evals | Evaluation workflows | Evals/use cases | Harness pending campaign | Continuous benchmark system |

## Architecture Required for 9/10+

```text
CLI / TUI / IDE Adapter
        |
Request Intake and Classification
        |
Execution Policy Engine
        |-- mode selection
        |-- task-class sign-off
        |-- budgets and limits
        |-- security and approval policy
        |
Context Intelligence Plane
        |-- repository index
        |-- lexical search
        |-- semantic search
        |-- symbol/call-graph search
        |-- git/change-history search
        |-- parallel retrieval agent
        |-- ranking and deduplication
        |-- progressive expansion
        |
Planner
        |-- implementation contract
        |-- files and scope
        |-- required checks
        |-- risk and rollback plan
        |
Durable Run Coordinator
        |-- journal and unique IDs
        |-- task-state machine
        |-- retries and circuit breakers
        |-- timeouts and cancellation
        |-- checkpoints and recovery
        |-- worktree and pane lifecycle
        |
Dispatcher Layer
        |-- Claude adapter
        |-- Codex adapter
        |-- Pi/LiteLLM adapter
        |-- local/open model adapter
        |
Tool and Prompt Layer
        |-- scoped tools
        |-- deferred tool discovery
        |-- stable prompt construction
        |-- provider prompt caching
        |-- structured tool schemas
        |
Validation and Review
        |-- tests/lint/typecheck
        |-- scope and diff validation
        |-- security checks
        |-- reviewer model
        |-- repair loop
        |
Memory and Learning
        |-- ephemeral run memory
        |-- verified project facts
        |-- decisions and procedures
        |-- recurring-feedback promotion
        |-- scoped rules proposals
        |
Metrics, Evals, and Operations
        |-- tokens/cache/cost/latency
        |-- quality and pass rate
        |-- retrieval quality
        |-- benchmark regression gates
        `-- audit and incident evidence
```

## A-to-Z Implementation Plan

The following plan is intentionally implementation-ready but does not authorize implementation.

## A — Acceptance Baseline

### Build

- Freeze the current coordinator, router, prompts, model registry, tool profiles, and benchmarks as baseline version `v0`.
- Record current test results and known environment-specific failures.
- Define the exact formula used for every assessment score.
- Define production release gates and explicit evidence requirements.

### Deliverables

- `docs/scorecard.md`
- Versioned baseline configuration manifest
- Initial production gate checklist

### Acceptance

- Every score can be reproduced from named evidence.
- No category can be raised based only on code existence.

## B — Benchmark Corpus

### Build

- Create representative tasks for every supported task class.
- Include small, medium, large, ambiguous, failure-prone, and cross-file tasks.
- Use multiple real repositories and languages.
- Store expected outcomes, constraints, allowed files, required checks, and scoring rubrics.
- Separate public fixtures from private project fixtures.

### Metrics

- Success rate
- First-pass success
- Quality score
- Scope compliance
- Tokens and cached tokens
- Cost
- Latency
- Retries and repairs
- Human corrections

### Acceptance

- Every enabled task class has sufficient representative fixtures.
- Benchmarks are versioned and repeatable.

## C — Context Index

### Build

- Replace provisional retrieval with a production hybrid index.
- Index file paths, symbols, signatures, imports, exports, tests, configuration, and documentation.
- Add lexical and semantic indexes.
- Add incremental updates from file-system and git changes.
- Add ignore patterns, secret exclusions, generated-file exclusions, and repository boundaries.
- Store index version, source commit, embedder version, and freshness.

### Acceptance

- Incremental updates are correct after edits, moves, and deletes.
- Retrieval never returns ignored or unauthorized content.
- Index state is inspectable and rebuildable.

## D — Dedicated Retrieval Plane

### Build

- Add a specialized retrieval agent before planning or execution.
- Restrict tools to `grep`, `glob`, symbol search, dependency lookup, git history, and bounded reads.
- Run multiple query variants in parallel.
- Limit rounds, tool calls, bytes, tokens, and latency.
- Return ranked references with relevance explanations.
- Keep retrieved content separate from the main prompt until selected.

### Acceptance

- Retrieval consumes materially fewer tokens than unrestricted agent exploration.
- Relevant-file recall meets an agreed benchmark threshold.
- Irrelevant-context rate is measured and bounded.

## E — Expansion and Structural Context

### Build

- Produce structural file summaries containing symbols, signatures, imports, callers, tests, and recent changes.
- Allow targeted expansion by symbol or line range.
- Use head-and-tail preservation for unstructured failures.
- Store full artifacts outside the prompt and pass references.
- Display included, condensed, expanded, and omitted context.

### Acceptance

- Large files are not placed into context by default.
- Failure details and referenced symbols survive condensation.
- The model can request precise expansion without re-reading whole files.

## F — Full Live Dispatch

### Build

- Implement Claude frontier adapter.
- Implement Codex frontier adapter.
- Implement Pi → LiteLLM/Ikey workhorse adapter.
- Normalize output, usage, tool calls, stop reasons, errors, and provider metadata.
- Route all supported execution through `gopilot run`.

### Acceptance

- The supported CLI completes real tasks through every enabled plane.
- Dry-run and live plans resolve identically before dispatch.
- No shell helper bypass is required for normal operation.

## G — Governed Execution Modes

### Build

- Add enforced strategies:
  - `single-agent`
  - `multi-agent`
  - `retrieval-only`
  - `plan-only`
  - `plan-then-execute`
  - `review-only`
  - `background`
  - `candidate-race`
- Give every mode its own dispatcher topology, tools, limits, validation, and memory policy.
- Make unsigned task classes select a real single-agent baseline.

### Acceptance

- Mode changes produce different enforced runtime behavior.
- The coordinator cannot label a run single-agent while dispatching a multi-agent topology.

## H — Hard Budgets and Limits

### Build

- Enforce limits per call, worker, task, project, user, and day.
- Limit input, output, turns, tools, retrieval expansions, retries, workers, cost, and wall time.
- Add reserve budgets for validation and final reporting.
- Add graceful downgrade and explicit refusal behavior.

### Acceptance

- Tests prove that every budget terminates or downgrades safely.
- No run can exceed its configured maximum silently.

## I — Instruction and Rule Engine

### Build

- Support nested repository instructions based on directory scope.
- Distinguish always-on, path-triggered, model-selected, and manually invoked rules.
- Keep always-on instructions concise.
- Detect conflicting rules and show resolution order.
- Add rule linting and token-cost reporting.

### Acceptance

- Only applicable rules enter each worker context.
- Rule precedence is deterministic and inspectable.

## J — Journal and Durable Runtime Integration

### Build

- Integrate durable run/task IDs into the coordinator.
- Journal every lifecycle transition before external side effects.
- Integrate idempotent dispatch.
- Reconcile incomplete work on startup.
- Persist artifacts, plans, outputs, validations, and final state.

### Acceptance

- Killing the coordinator at every lifecycle stage causes no lost or duplicated work.
- Recovered runs retain the same trace and identity.

## K — KV and Prompt Caching

### Build

- Create a stable prompt-section builder.
- Put stable tools and instructions before dynamic task data.
- Implement Anthropic cache breakpoints.
- Capture cached-input fields from OpenAI and other providers where available.
- Add cache pre-warming for frequently used profiles.
- Track cache hit, write, read, miss, invalidation, latency, and savings.
- Canonicalize JSON and tool ordering.

### Acceptance

- Repeated worker profiles demonstrate measurable cache hits.
- Cache invalidation causes are visible by run ID.
- Cached and uncached outputs remain behaviorally equivalent.

## L — Lazy Tool and Skill Loading

### Build

- Start each worker with a minimal stable tool set.
- Provide compact tool/skill names and descriptions.
- Load full schemas and skill content only when selected.
- Cache the stable base tool prefix.
- Enforce capability and security policy during discovery.

### Acceptance

- Initial tool-schema tokens fall materially below the static baseline.
- Unauthorized or incompatible tools cannot be discovered.

## M — Mandatory Validation Contracts

### Build

- Define validation contracts per task class.
- Require explicit checks before success or memory promotion.
- Support tests, lint, typecheck, build, scope, diff, placeholder, security, and policy checks.
- Treat zero applicable checks as unknown or failure according to policy.
- Reserve time and token budget for validation.

### Acceptance

- No implementation task is marked successful without its required evidence.
- No unvalidated result enters persistent memory.

## N — Normalized Usage Accounting

### Build

- Normalize provider usage into input, output, reasoning, cached read, cached write, retrieval, router, retry, repair, validation, and summary categories.
- Treat missing quality as unknown rather than perfect.
- Reconcile gateway, CLI, and provider totals.
- Store model, version, provider, prompt version, tools version, and index version.

### Acceptance

- Total run usage equals the sum of all components.
- Missing fields cannot accidentally produce a passing acceptance verdict.

## O — Observability Integration

### Build

- Emit structured events from the coordinator, dispatchers, retrieval, tools, validation, memory, and cleanup.
- Add run timeline, cost breakdown, context breakdown, and failure tree.
- Add dashboards or reports by project, model, provider, class, and execution mode.
- Add redaction before persistence or export.

### Acceptance

- Any expensive or failed run can be diagnosed using only its run ID.
- Sensitive values are absent from stored events.

## P — Planner, Executor, Reviewer

### Build

- Use retrieval output to create a structured implementation contract.
- Separate planner, executor, and reviewer roles for complex tasks.
- Require plans to name scope, files, risks, tests, and rollback.
- Prevent executors from expanding scope without an explicit plan amendment.
- Give reviewers an independent context and rubric.

### Acceptance

- Complex tasks show fewer scope violations and retries than direct execution.
- Planner overhead is included in total savings calculations.

## Q — Quality Evaluation System

### Build

- Combine deterministic graders, model graders, and human review.
- Blind model graders to provider and execution mode.
- Calibrate graders against human judgments.
- Track false positives and false negatives.
- Keep quality dimensions separate: correctness, completeness, maintainability, security, and scope.

### Acceptance

- Quality measurements are reproducible and resistant to provider bias.
- Acceptance decisions use sufficient sample counts and confidence ranges.

## R — Retry, Repair, and Escalation Integration

### Build

- Wire retry, backoff, jitter, cancellation, and circuit breakers into dispatch.
- Classify retryable and non-retryable failures.
- Detect equivalent repeated failures.
- Escalate models or switch strategy instead of blindly retrying.
- Include repair prompts and tool corrections in usage totals.

### Acceptance

- Retry storms are impossible under configured limits.
- Escalation improves success more efficiently than repeated weak-model attempts.

## S — Security and Approval Policy

### Build

- Define sandbox and permission profiles by execution mode.
- Authenticate every local or remote IPC connection.
- Validate all messages and tool inputs.
- Bound message, output, connection, and concurrency sizes.
- Add secret scanning and prompt-injection controls.
- Require approvals for destructive, external, privileged, or high-risk actions.
- Run dependency, container, and configuration security scans.

### Acceptance

- Security tests cover unauthorized peers, oversized data, malicious repository instructions, prompt injection, and secret exfiltration attempts.
- Production deployment passes a documented security checklist.

## T — Typed Memory and Learning

### Build

- Separate ephemeral observations, project facts, decisions, procedures, preferences, mistakes, and rules proposals.
- Attach provenance, confidence, validation evidence, expiry, project, and scope.
- Retrieve only relevant memory types.
- Deduplicate, supersede, expire, and delete memories.
- Never treat memory as authoritative over explicit current instructions.

### Acceptance

- Memory retrieval improves benchmark quality without unacceptable context growth.
- Stale or contradicted memories are not silently reused.

## U — User Feedback to Rules

### Build

- Detect repeated corrections and review comments.
- Create rule proposals rather than automatically modifying durable instructions.
- Show evidence, scope, expected token cost, and conflicts.
- Require review before repository rule updates.
- Periodically detect obsolete or redundant rules.

### Acceptance

- Recurring mistakes decline after approved rule promotion.
- Rule growth remains bounded and scoped.

## V — Versioned Model and Prompt Governance

### Build

- Pin models, prompts, tool schemas, retrieval policy, rules, and grader versions.
- Add staged rollouts and rollback.
- Run benchmarks before activating a new version.
- Record resolved versions in every run.
- Detect provider capability drift.

### Acceptance

- No model or prompt change reaches production without regression evidence.
- Every production result is reproducible from recorded configuration.

## W — Worktrees, Checkpoints, and Review UX

### Build

- Integrate worktree creation and cleanup into the coordinator.
- Create checkpoints before and after material stages.
- Add named restore points.
- Provide a clear diff review with validation evidence.
- Support accept, reject, amend, retry, and compare-candidate actions.

### Acceptance

- Operators can safely inspect and revert every agent change.
- Interrupted runs leave no unmanaged worktrees or panes.

## X — Cross-Platform Acceptance

### Build

- Test Windows, WSL2, macOS Intel, macOS Apple Silicon, and supported Linux environments.
- Validate install, upgrade, uninstall, Compose, Herdr, Pi, Claude, Codex, CCE/indexing, RTK, locks, worktrees, sockets, and recovery.
- Add per-platform smoke commands.
- Clearly label unsupported combinations.

### Acceptance

- The documented quickstart works unmodified on every claimed platform.
- Platform-specific limitations are tested and documented.

## Y — Yield and Candidate Racing

### Build

- Add selective parallel candidate execution for difficult but verifiable tasks.
- Support different models, prompts, plans, or retrieval sets.
- Validate candidates independently.
- Stop remaining candidates once a sufficient winner exists.
- Select by quality, cost, latency, or configurable utility.

### Acceptance

- Racing is enabled only where expected retry savings exceed added parallel cost.
- Candidate selection improves benchmark utility over the best single-attempt policy.

## Z — Zero-to-Production Pilot

### Build

- Freeze a release candidate.
- Complete security, backup, restore, migration, and rollback procedures.
- Run shadow comparisons against the single-agent baseline.
- Run a limited trusted-user pilot on real projects.
- Define incident response, privacy, retention, and support ownership.
- Publish benchmark results and known limits.

### Acceptance

- Pilot meets quality, token, cost, latency, reliability, and security targets for the defined observation period.
- No unresolved critical or high-severity production blocker remains.
- All assessment scores have evidence supporting at least 9/10.

## Score Improvement Plan

## Architecture: 8/10 → 9/10 → 10/10

### To reach 9/10

- Complete live dispatch through the supported coordinator.
- Add the dedicated retrieval plane.
- Add enforced execution strategies.
- Integrate planner, executor, reviewer, validation, memory, and metrics into one runtime.
- Apply context policy to the complete composed prompt.
- Fail closed on unresolved models, routes, tools, and validation contracts.

### To reach 10/10

- Support the same run contract across local, pane, and remote execution.
- Add evidence-generated routing and policy calibration.
- Demonstrate modular replacement of providers, indexes, memories, and dispatchers without semantic drift.

## Component Implementation: 8/10 → 9/10 → 10/10

### To reach 9/10

- Wire every production component into `runTask()` or its successor.
- Remove metadata-only guarantees.
- Add typed contracts between modules.
- Add portable end-to-end tests and representative integration tests.
- Eliminate stale documentation and generated test-count drift.

### To reach 10/10

- Add compatibility and property tests across providers.
- Add fuzzing for parsers, IPC, schemas, and state transitions.
- Maintain stable plugin/adapter interfaces with conformance suites.

## Reliability Foundation: 7/10 → 9/10 → 10/10

### To reach 9/10

- Integrate the journal, state machine, retry, breaker, cancellation, timeout, cleanup, and recovery paths.
- Add kill tests at every lifecycle stage.
- Add stale pane, stale worktree, provider outage, memory outage, and partial-output recovery.
- Prove idempotent dispatch and completion.

### To reach 10/10

- Run long-duration soak tests.
- Add chaos testing and service-degradation simulation.
- Establish reliability SLOs and automatic regression alerts.

## Security Foundation: 6.5/10 → 9/10 → 10/10

### To reach 9/10

- Finish production authentication and secret handling.
- Integrate sandbox and approval policies into every dispatcher.
- Add prompt-injection and repository-instruction threat controls.
- Pin and scan all deployment inputs.
- Test backup, restore, migration, and rollback.
- Complete a formal threat model.

### To reach 10/10

- Conduct an independent security review.
- Add signed artifacts or provenance for releases.
- Add automated policy compliance and audit export.
- Resolve all high-severity findings and document accepted residual risk.

## Production Readiness: 5.5/10 → 9/10 → 10/10

### To reach 9/10

- Deliver real `gopilot run` execution.
- Complete cross-platform clean-machine acceptance.
- Add operational dashboards, run inspection, alerts, and support procedures.
- Complete controlled pilot and release checklist.
- Publish accurate install, upgrade, uninstall, backup, and incident documentation.

### To reach 10/10

- Complete multiple successful pilot cycles across teams and repositories.
- Demonstrate upgrades and rollbacks without data or work loss.
- Establish ongoing operational ownership and release governance.

## Token-Efficiency Proof: 3/10 → 9/10 → 10/10

### To reach 9/10

- Complete the live benchmark campaign.
- Include retrieval, planning, routing, retries, repair, validation, summaries, and cached tokens.
- Add prompt caching and cache telemetry.
- Establish break-even policies for single versus multi-agent execution.
- Require every enabled class to meet reduction and quality targets.
- Report distributions, confidence, and sample counts.

### To reach 10/10

- Continuously benchmark every model, prompt, tool, and routing change.
- Automatically propose policy adjustments from measured evidence.
- Demonstrate sustained savings across multiple repositories, languages, providers, and workload sizes.
- Detect and block token-efficiency regressions before release.

## Recommended Build Order

### Milestone 1 — Enforced Live Runtime

Complete sections F, G, J, M, N, O, and R.

**Exit gate:** A real run uses the supported CLI and cannot bypass durability, validation, metrics, or failure handling.

### Milestone 2 — Context Intelligence

Complete sections C, D, E, I, K, and L.

**Exit gate:** Retrieval and caching measurably reduce context tokens without degrading relevant-context recall.

### Milestone 3 — Quality System

Complete sections P, Q, T, U, and W.

**Exit gate:** Complex tasks use verified planning/review loops, and feedback becomes controlled reusable knowledge.

### Milestone 4 — Security and Portability

Complete sections H, S, V, and X.

**Exit gate:** Production security and cross-platform checklists pass with no high-severity blocker.

### Milestone 5 — Evidence and Optimization

Complete sections A, B, Y, and Z.

**Exit gate:** Representative benchmarks and a controlled pilot support every 9/10 assessment.

## Required Metrics Dashboard

Every production run should expose:

- Run, task, project, user, and parent IDs.
- Execution mode and topology.
- Task class and sign-off status.
- Router decision and confidence.
- Model, provider, and version.
- Prompt, tool, rules, index, and grader versions.
- Input, output, reasoning, cache-read, and cache-write tokens.
- Retrieval tokens and retrieved-reference count.
- Context included, condensed, expanded, omitted, and artifact-backed.
- Tool calls, retries, repairs, and escalations.
- Latency, queue time, and time to first token.
- Monetary cost.
- Validation results.
- Quality score and grader provenance.
- Memory reads, writes, rejections, and promotions.
- Worktree, checkpoint, and final diff identifiers.
- Final result, failure class, and recovery state.

## Final Production Gate

Go-pilot may be described as production-ready only when all of the following are true:

- [ ] `gopilot run` performs real governed execution.
- [ ] Single-agent fallback is an enforced topology.
- [ ] Unknown routes and models fail safely.
- [ ] Mandatory validation contracts are active.
- [ ] Reliability, journal, recovery, and observability are integrated.
- [ ] A specialized retrieval plane is active.
- [ ] Structural progressive context expansion is active.
- [ ] Prompt caching is implemented and measured where supported.
- [ ] Tool and skill loading is progressive and policy-controlled.
- [ ] Token, cache, retry, repair, validation, and routing usage reconciles to provider totals.
- [ ] Every enabled multi-agent class passes representative benchmarks.
- [ ] Security and prompt-injection checks pass.
- [ ] Backup, restore, upgrade, migration, and rollback have been tested.
- [ ] Claimed platforms pass clean-machine acceptance.
- [ ] A controlled pilot meets the defined observation-period targets.
- [ ] Every assessment category has evidence supporting at least 9/10.

## Final Recommendation

Do not rewrite the current system. The foundation is strong and directly compatible with the industry techniques identified in this research.

The next session should begin with the **Enforced Live Runtime** milestone. Adding more standalone optimization modules before live dispatch and enforcement would increase surface area without improving production readiness. Once the runtime is complete, build the dedicated retrieval and prompt-caching layers, then execute the benchmark and pilot program needed to prove the product's core token-efficiency claim.

The success condition is not feature parity with an IDE. It is a terminal-native, provider-independent agent harness that delivers equal or better context efficiency, verification quality, operational control, and measurable cost performance.
