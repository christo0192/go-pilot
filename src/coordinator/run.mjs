import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { route, loadConfig } from "../router/router.mjs";
import { piToolArgs, loadToolProfiles } from "../router/tool-profiles.mjs";
import { guardBoundary } from "../boundary/guard.mjs";
import { resolveModel } from "../config/governance.mjs";
import { mustPass, noPlaceholders } from "../memory/gate.mjs";
import { promote } from "../memory/promotion.mjs";
import { recall } from "../memory/recall.mjs";
import { withYagni } from "../prompts/fragment.mjs";
import { buildPrompt } from "../prompts/builder.mjs";
import { signoff } from "../metrics/signoff.mjs";
import { validateRecord, computeRun, recordRun } from "../metrics/metrics.mjs";
import { resolveContract, modeGovernance } from "../runtime/contracts.mjs";
import { retrieveContext } from "../context/retrieve.mjs";
import { createJournal } from "../reliability/journal.mjs";
import { createCircuitBreaker, withRetry, isTransientError } from "../reliability/retry.mjs";
import { createEventLog } from "../observability/events.mjs";
import { discoverInstructions } from "../instructions/rules.mjs";
import { captureWorkspace, workspaceDelta } from "../runtime/workspace.mjs";
import { validateJson, validateCitations } from "../validation/validate.mjs";
import { buildEvidencePack } from "../context/evidence.mjs";

// Process-global by design: a circuit breaker must persist across runs to trip.
// The registry is injectable (opts.breakers) so tests get isolation instead of
// order-dependent shared state.
const globalBreakers = new Map();

function breakerFor(registry, key, opts = {}) {
  if (!registry.has(key)) registry.set(key, createCircuitBreaker(opts));
  return registry.get(key);
}

function resultText(result) {
  if (typeof result === "string") return result;
  if (result && typeof result.text === "string") return result.text;
  return JSON.stringify(result ?? "");
}

function defaultChecks(names, task, evidenceIds = []) {
  return names.map((name) => {
    if (name === "non-empty") return { name, run: (result) => resultText(result).trim().length > 0 };
    if (name === "no-placeholders") return noPlaceholders();
    if (name === "structured-output") return {
      name,
      run: (result) => {
        if (!task.schema && task.outputFormat !== "json") return true;
        return validateJson(resultText(result), { schema: task.schema }).ok;
      },
    };
    if (name === "citations") return { name, run: (result) => validateCitations(resultText(result), { evidenceIds, minCitations: 1 }).ok };
    throw new Error(`unknown required validation check "${name}"`);
  });
}

function mergeUsage(a = {}, b = {}) {
  const at = a.tokens || {};
  const bt = b.tokens || {};
  const keys = ["input", "output", "reasoning", "cached", "cacheRead", "cacheWrite", "total"];
  const tokens = Object.fromEntries(keys.map((key) => [key, (Number(at[key]) || 0) + (Number(bt[key]) || 0)]));
  return {
    ...b,
    tokens,
    costUsd: (Number(a.costUsd) || 0) + (Number(b.costUsd) || 0),
    latencyMs: (Number(a.latencyMs) || 0) + (Number(b.latencyMs) || 0),
    toolCalls: (Number(a.toolCalls) || 0) + (Number(b.toolCalls) || 0),
    attempts: [...(a.attempts || [a]).filter((x) => Object.keys(x).length), ...(b.attempts || [b]).filter((x) => Object.keys(x).length)],
  };
}

function normalizeUsage(usage = {}) {
  const raw = usage.tokens;
  if (raw && typeof raw === "object" && Number.isFinite(raw.single) && Number.isFinite(raw.multi)) {
    return { comparison: { single: raw.single, multi: raw.multi }, detail: raw };
  }
  const total = typeof raw === "number" ? raw : Number.isFinite(raw?.total) ? raw.total : null;
  const baseline = Number.isFinite(usage.baseline) ? usage.baseline : null;
  return { comparison: total != null && baseline != null ? { single: baseline, multi: total } : null, detail: raw || {} };
}

function metricsRecord({ runId, category, usage, routerOverheadTokens }) {
  const normalized = normalizeUsage(usage);
  if (!normalized.comparison || !usage.quality || !Number.isFinite(usage.quality.single) || !Number.isFinite(usage.quality.multi)) return null;
  return {
    runId,
    taskClass: category,
    tokens: normalized.comparison,
    quality: usage.quality,
    retries: usage.retries || { count: 0, attempts: 1 },
    routerOverheadTokens,
  };
}

function eventSink(path) {
  if (!path) return undefined;
  mkdirSync(dirname(path), { recursive: true });
  return (record) => {
    appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
  };
}

export async function runTask(task = {}, opts = {}) {
  const profile = opts.profile;
  if (!profile || typeof profile !== "string") throw new Error("runTask: opts.profile is required");
  const category = typeof task.category === "string" ? task.category : undefined;
  const runId = task.id || `run-${randomUUID()}`;
  const mapping = loadConfig(profile, opts);
  const toolProfiles = loadToolProfiles(opts.toolProfilesPath ? { configPath: opts.toolProfilesPath } : undefined);
  const contract = resolveContract(category, { path: opts.contractPath, override: opts.contract });
  const events = opts.events || createEventLog({ sink: eventSink(opts.eventLogPath) });
  events.emit({ runId, kind: "run.started", profile, category, mode: contract.mode });

  const signResult = signoff(opts.signoffRecords ?? {}, opts.targets ?? {});
  const signedOff = category != null && signResult.signedOff.includes(category);
  const requestedMode = opts.mode || contract.mode;
  // Only EFFICIENCY-GATED parallel modes (multi-agent) are downgraded when a
  // class is not signed off. Cost-opt-in modes (candidate-race) are NOT gated by
  // the efficiency sign-off — they are governed by explicit cost approval below.
  const execution = modeGovernance(requestedMode).efficiencyGated && !signedOff ? "single-agent" : requestedMode;
  // Downgraded == the requested mode was actually changed (an efficiency-gated
  // mode forced to single-agent). A plain single-agent or an opt-in
  // candidate-race run is NOT a downgrade, so don't mislabel it as one.
  const downgraded = execution !== requestedMode;

  let decision = route(task, { profile, config: mapping });
  let needsJudgment = decision.deterministic !== true;
  if (decision.deterministic !== true) {
    if (typeof opts.judgeRoute !== "function") throw new Error("ambiguous task requires opts.judgeRoute; refusing null dispatch");
    decision = await opts.judgeRoute(task, { profile, mapping, contract });
    needsJudgment = true;
  }
  if (!decision?.plane || !decision?.model) throw new Error("routing did not resolve plane and model");
  const resolved = resolveModel(decision.model, { registryPath: opts.registryPath });
  if (resolved.plane !== decision.plane) throw new Error(`resolved model plane mismatch for ${decision.model}`);
  const resolvedFallback = decision.fallback ? resolveModel(decision.fallback.model, { registryPath: opts.registryPath }) : null;
  if (resolvedFallback && resolvedFallback.plane !== decision.fallback.plane) throw new Error(`resolved fallback plane mismatch for ${decision.fallback.model}`);
  const tools = piToolArgs(category, { profiles: toolProfiles });
  const discoveredRules = opts.rules === false ? { text: "", files: [], tokens: 0 } :
    discoverInstructions(opts.cwd || process.cwd(), { root: opts.rulesRoot || opts.cwd || process.cwd() });

  let memoryContext = { text: "", used: [], tokens: 0 };
  if (!opts.dryRun && opts.adapter) memoryContext = await recall(opts.adapter, task.context ?? task.prompt, opts.recall ?? {});
  const retrieval = opts.retrieve === false ? { text: "", files: [], tokens: 0 } :
    await Promise.resolve((opts.retriever || retrieveContext)(task.prompt || "", {
      cwd: opts.cwd,
      maxFiles: contract.maxRetrievalFiles,
      maxTokens: contract.maxRetrievalTokens,
    }));
  let evidenceIds = [];
  let governedTaskContext = typeof task.context === "string" ? task.context : "";
  if (category === "doc-qa" && governedTaskContext) {
    const evidence = buildEvidencePack(governedTaskContext, task.prompt || "", {
      maxChars: Math.min(12000, contract.maxRetrievalTokens * 4),
    });
    evidenceIds = evidence.ids;
    governedTaskContext = evidence.block;
  }
  const context = [memoryContext.text, retrieval.text, governedTaskContext].filter(Boolean).join("\n\n");
  const promptBase = buildPrompt({
    policy: withYagni(""),
    rules: typeof opts.rules === "string" ? opts.rules : discoveredRules.text,
    toolSummary: tools.join(" "),
    task: task.prompt || "",
  });
  const inputBudget = Math.min(contract.maxInputTokens, opts.boundaryThreshold ?? contract.maxInputTokens);
  if (promptBase.tokens > inputBudget) throw new Error(`task and stable instructions exceed input budget (${promptBase.tokens} > ${inputBudget})`);
  let contextBudget = Math.max(0, inputBudget - promptBase.tokens - 12);
  let contextBoundary;
  let prompt;
  for (;;) {
    contextBoundary = guardBoundary({ tier: "full", content: context }, { threshold: contextBudget });
    const safeContext = contextBoundary.content || (contextBoundary.ref ? `Context artifact: ${contextBoundary.ref}` : "");
    prompt = buildPrompt({
      policy: withYagni(""), rules: typeof opts.rules === "string" ? opts.rules : discoveredRules.text, toolSummary: tools.join(" "), context: safeContext, task: task.prompt || "",
    });
    if (prompt.tokens <= inputBudget || contextBudget === 0) break;
    contextBudget = Math.max(0, contextBudget - (prompt.tokens - inputBudget) - 8);
  }
  if (prompt.tokens > inputBudget) throw new Error(`composed prompt exceeds input budget (${prompt.tokens} > ${inputBudget})`);
  const boundary = { ...contextBoundary, promptTokens: prompt.tokens, inputBudget };
  let safePrompt = prompt.text;
  if (category === "extract" && (task.schema || task.outputFormat === "json")) {
    const schemaInstruction = task.schema
      ? `\n\nReturn ONLY JSON matching this schema exactly:\n${JSON.stringify(task.schema)}`
      : "\n\nReturn ONLY valid JSON. Do not wrap it in prose.";
    safePrompt += schemaInstruction;
  }
  if (category === "doc-qa") {
    safePrompt += "\n\nCite supporting evidence with the exact [chunk-id] markers supplied in the context. Do not cite identifiers that are not present.";
  }

  const plan = {
    runId, profile, category: category ?? null, plane: decision.plane, model: decision.model,
    provider: resolved.provider, version: resolved.version,
    fallback: decision.fallback ? { ...decision.fallback, provider: resolvedFallback.provider, version: resolvedFallback.version } : null,
    tools, execution,
    requestedMode, signedOff, downgraded, contextTier: boundary.tier, contract,
    retrieval: { files: retrieval.files?.map((f) => f.file) || [], tokens: retrieval.tokens || 0 },
    cache: prompt.cache, needsJudgment,
    rules: { files: discoveredRules.files.map((file) => file.path), tokens: discoveredRules.tokens },
  };
  events.emit({ runId, kind: "run.planned", profile, category, model: decision.model, provider: resolved.provider, mode: execution, tokens: prompt.tokens });

  if (opts.dryRun) return {
    plan, dispatched: false, validated: false, promoted: false, verdict: "dry-run", metrics: null,
    failures: [], boundary, recall: { used: memoryContext.used, tokens: memoryContext.tokens }, events: events.byRun(runId),
  };
  if (execution === "retrieval-only") return {
    plan, dispatched: false, validated: true, promoted: false, verdict: "ok", metrics: null,
    failures: [], result: retrieval, boundary, recall: { used: memoryContext.used, tokens: memoryContext.tokens }, events: events.byRun(runId),
  };
  if (category === "doc-qa" && evidenceIds.length === 0) {
    throw new Error("doc-qa requires task.context so answers can be validated against evidence citations");
  }
  if (typeof opts.dispatch !== "function") throw new Error("runTask: opts.dispatch is required for a live run");

  // Cost-opt-in modes (candidate-race) run multiple parallel panes and multiply
  // spend. They are NOT sign-off-gated (they make no efficiency claim), so guard
  // the COST axis explicitly: a live run needs deliberate approval, never a
  // stray `--mode`. Dry-run above still shows the plan without this gate.
  if (modeGovernance(execution).costOptIn && !(opts.allowParallelCost || contract.allowParallelCost)) {
    throw new Error(
      `execution mode "${execution}" runs parallel panes and multiplies cost; it is not gated by the efficiency sign-off but requires explicit cost approval — pass allowParallelCost:true (CLI: --allow-parallel-cost)`,
    );
  }
  if (modeGovernance(execution).parallel) {
    events.emit({ runId, kind: "run.parallel_approved", mode: execution, costOptIn: modeGovernance(execution).costOptIn });
  }

  // Workspace capture shells out to `git diff --binary`; on a large/dirty repo
  // that is a real per-run cost. On by default (checkpoint evidence), opt out
  // with captureWorkspace:false.
  const captureEnabled = opts.captureWorkspace !== false;
  const workspaceBefore = captureEnabled ? captureWorkspace(opts.cwd || process.cwd()) : { git: false };
  const stateDir = opts.stateDir || mkdtempSync(resolve(tmpdir(), "gopilot-run-"));
  const journalPath = opts.journalPath || resolve(stateDir, "journal.jsonl");
  mkdirSync(dirname(journalPath), { recursive: true });
  const journal = opts.journal || createJournal(journalPath);
  // Durable runs (caller-pinned journal/stateDir + a stable task.id) reconcile
  // any work left in-flight by a prior crash. With the ephemeral defaults
  // (random runId + temp dir) there is nothing to reconcile.
  if (opts.journal || opts.stateDir || opts.journalPath) {
    const inflight = journal.reconcile();
    if (inflight.length) events.emit({ runId, kind: "run.reconcile", inflight });
  }
  const breakerRegistry = opts.breakers || globalBreakers;
  const breaker = opts.breaker || breakerFor(breakerRegistry, `${decision.plane}/${resolved.version}`, opts.breakerOptions);
  const started = Date.now();
  const checks = [...defaultChecks(contract.requiredChecks, task, evidenceIds), ...(Array.isArray(task.checks) ? task.checks : [])];
  const executeAttempt = (key, attemptPrompt, role) => journal.dispatchOnce(key, () => breaker.run(() => withRetry(
    () => opts.dispatch({
      runId, plane: decision.plane, model: decision.plane === "workhorse" ? resolved.version : decision.model,
      modelAlias: decision.model, provider: resolved.provider, tools, prompt: attemptPrompt,
      category, mode: execution, role, contract, cwd: opts.cwd,
    }),
    { retries: contract.maxRetries, signal: opts.signal, shouldRetry: opts.shouldRetry || isTransientError },
  )));
  let dispatched;
  let primaryError = null;
  let parallelCostUsd = null; // total observed cost across parallel panes, if any
  try {
    if (execution === "plan-only") {
      dispatched = await executeAttempt(`${runId}:plan:0`, `${safePrompt}\n\nReturn an implementation plan only. Do not edit files.`, "planner");
    } else if (execution === "plan-then-execute") {
      const planned = await executeAttempt(`${runId}:plan:0`, `${safePrompt}\n\nCreate a precise implementation plan. Do not edit files yet.`, "planner");
      dispatched = await executeAttempt(
        `${runId}:execute:0`,
        `${safePrompt}\n\n## approved-plan\n${resultText(planned.result)}\n\nExecute this plan and validate the result.`,
        "executor",
      );
    } else if (execution === "multi-agent" || execution === "candidate-race") {
      // allSettled, NOT all: one candidate erroring must not abort a run that
      // has a passing sibling — surviving a single failure is the entire point
      // of the redundancy. Fail closed only if EVERY candidate errored.
      const settled = await Promise.allSettled([
        executeAttempt(`${runId}:candidate:0`, `${safePrompt}\n\nSolve independently. Prefer the smallest verified change.`, "candidate"),
        executeAttempt(`${runId}:candidate:1`, `${safePrompt}\n\nSolve independently. Explore edge cases and verify carefully.`, "candidate"),
      ]);
      const fulfilled = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
      if (fulfilled.length === 0) throw settled.find((s) => s.status === "rejected").reason;
      parallelCostUsd = fulfilled.reduce((sum, c) => sum + (Number.isFinite(c.usage?.costUsd) ? c.usage.costUsd : 0), 0);
      const evaluated = fulfilled.map((candidate) => ({ candidate, gate: mustPass(candidate.result, checks) }));
      const passing = evaluated.filter((item) => item.gate.passed);
      if (passing.length === 0) dispatched = fulfilled[0];
      else dispatched = passing.sort((a, b) => {
        const ta = normalizeUsage(a.candidate.usage).detail?.total ?? Number.MAX_SAFE_INTEGER;
        const tb = normalizeUsage(b.candidate.usage).detail?.total ?? Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })[0].candidate;
    } else {
      dispatched = await executeAttempt(`${runId}:dispatch:0`, safePrompt, "executor");
    }
  } catch (error) {
    events.emit({ runId, kind: "dispatch.failed", ok: false, error: error.message, latencyMs: Date.now() - started, model: decision.model, provider: resolved.provider });
    if (!decision.fallback || !resolvedFallback) throw error;
    primaryError = error;
    dispatched = { result: { text: "" }, usage: {} };
  }
  let { result, usage = {} } = dispatched || {};
  let selectedUsage = usage;
  let gate = mustPass(result, checks);
  let fallbackUsed = false;
  let fallbackAttempted = false;
  if (!gate.passed && decision.fallback && resolvedFallback) {
    fallbackAttempted = true;
    const fallbackBreaker = breakerFor(breakerRegistry, `${decision.fallback.plane}/${resolvedFallback.version}`, opts.breakerOptions);
    const failures = primaryError
      ? `dispatch error: ${primaryError.message}`
      : gate.failures.map((f) => f.name || String(f)).join(", ");
    const fallbackPrompt = `${safePrompt}\n\nThe primary candidate failed: ${failures}. Produce a corrected complete answer.`;
    const fallback = await journal.dispatchOnce(`${runId}:fallback:0`, () => fallbackBreaker.run(() => withRetry(
      () => opts.dispatch({
        runId, plane: decision.fallback.plane,
        model: decision.fallback.plane === "workhorse" ? resolvedFallback.version : decision.fallback.model,
        modelAlias: decision.fallback.model, provider: resolvedFallback.provider, tools, prompt: fallbackPrompt,
        category, mode: execution, role: "validation-fallback", contract, cwd: opts.cwd,
      }),
      { retries: contract.maxRetries, signal: opts.signal, shouldRetry: opts.shouldRetry || isTransientError },
    )));
    const fallbackGate = mustPass(fallback.result, checks);
    usage = mergeUsage(usage, fallback.usage || {});
    events.emit({ runId, kind: "dispatch.fallback", ok: fallbackGate.passed, fromModel: decision.model, model: decision.fallback.model });
    if (fallbackGate.passed) {
      result = fallback.result;
      gate = fallbackGate;
      selectedUsage = fallback.usage || {};
      fallbackUsed = true;
    }
  }
  // Optional per-run cost budget (enforced when cost data is present — real
  // providers report costUsd). For parallel modes this is the summed pane cost.
  const observedCostUsd = parallelCostUsd != null ? parallelCostUsd : (Number.isFinite(usage.costUsd) ? usage.costUsd : 0);
  if (Number.isFinite(contract.maxCostUsd) && observedCostUsd > contract.maxCostUsd) {
    throw new Error(`run cost $${observedCostUsd} exceeded budget $${contract.maxCostUsd}`);
  }
  const workspace = captureEnabled
    ? workspaceDelta(workspaceBefore, captureWorkspace(opts.cwd || process.cwd()))
    : { available: false, changed: false, diff: "", status: "" };
  // When a contract requires a usage report (real providers do), a missing
  // output-token count is a fail-closed refusal — otherwise the output budget is
  // silently unenforced. Synthetic-usage callers leave requireUsageReport unset.
  if (contract.requireUsageReport && !Number.isFinite(selectedUsage.tokens?.output)) {
    throw new Error("dispatcher did not report output tokens; cannot enforce output budget (fail-closed)");
  }
  const outputTokens = Number.isFinite(selectedUsage.tokens?.output) ? selectedUsage.tokens.output : null;
  if (outputTokens != null && outputTokens > contract.maxOutputTokens) {
    throw new Error(`dispatcher exceeded output token budget (${outputTokens} > ${contract.maxOutputTokens})`);
  }
  if (Number.isFinite(usage.toolCalls) && usage.toolCalls > contract.maxToolCalls) {
    throw new Error(`dispatcher exceeded tool-call budget (${usage.toolCalls} > ${contract.maxToolCalls})`);
  }
  const effectiveModel = fallbackUsed ? decision.fallback.model : decision.model;
  const effectiveProvider = fallbackUsed ? resolvedFallback.provider : resolved.provider;
  events.emit({
    runId, kind: "dispatch.completed", ok: true, latencyMs: Date.now() - started,
    model: effectiveModel, provider: effectiveProvider, primaryModel: decision.model,
    fallbackAttempted, tokens: normalizeUsage(usage).detail?.total || 0,
    costUsd: usage.costUsd || 0, retries: usage.retries?.count || 0,
  });

  let promoted = false;
  if (gate.passed && opts.adapter) {
    // Cap the auto-distilled keeper text so a large result never bloats Tier-2.
    const memory = task.memory ||
      { text: resultText(result).slice(0, 1200), kind: task.kind, tags: task.tags };
    const report = await promote([{ memory, checks }], opts.adapter);
    promoted = report.promoted.length > 0;
  }
  const record = metricsRecord({ runId, category, usage, routerOverheadTokens: usage.routerOverheadTokens || 0 });
  let metrics = null;
  if (record && validateRecord(record).valid) {
    metrics = typeof opts.metrics === "function" ? opts.metrics(record, { logPath: opts.logPath }) :
      opts.logPath ? recordRun(record, { logPath: opts.logPath }) : computeRun(record);
  }
  const verdict = gate.passed ? "ok" : "failed";
  events.emit({ runId, kind: "run.completed", ok: gate.passed, profile, category, model: effectiveModel, provider: effectiveProvider, mode: execution, fallbackUsed });
  return {
    plan, dispatched: true, validated: gate.passed, promoted, verdict, metrics, failures: gate.failures,
    result, usage, fallbackUsed, fallbackAttempted, workspace, boundary, recall: { used: memoryContext.used, tokens: memoryContext.tokens }, events: events.byRun(runId),
  };
}
