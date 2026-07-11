// Run coordinator — the SINGLE enforced execution path (PLAN Step 8.1).
//
// GPT-FINDINGS P0 #1 / decision D33: every primitive exists as a tested library,
// but nothing COMPOSES and ENFORCES them, so a real run could bypass
// routing / boundary / validation / memory / metrics. This module is that
// composition. It is the ONLY supported way to run a task; every module it calls
// is an internal library. There is no bypass — each lifecycle stage is reached
// in order, and the returned verdict is the evidence that it was.
//
// Dispatch is an INJECTED interface: `opts.dispatch({plane, model, tools, prompt,
// category}) -> { result, usage }`. The real herdr / claude / pi dispatchers land
// in Step 8.8; tests inject a fake. Nothing in this module (or its imports) binds
// a socket or calls a network at import time — the only I/O is bounded config
// reads (router.json, tool-profiles.json, the YAGNI fragment) and, when a
// `logPath` is given, a metrics append.
//
// Lifecycle owned here, IN ORDER:
//   1. load + validate profile/config      (profile required; unknown -> Error)
//   2. classify / accept task class         (missing category -> judgment path)
//   3. per-class sign-off gate              (not signed off -> FORCE single-agent, D17)
//   4. route -> plane + model               (or costed judgment path)
//   5. tool profile -> worker tool set
//   6. recall (optional adapter)            -> bounded context injection (+YAGNI)
//   7. boundary                             -> nothing full-content crosses unjustified
//   8. DISPATCH (injected)                  -> { result, usage }   (skipped on dryRun)
//   9. validate result                      -> mustPass(result, checks)
//  10. promote validated keeper             -> Tier-2
//  11. metrics / verdict                    -> recordRun + structured verdict

import { route, loadConfig } from "../router/router.mjs";
import { piToolArgs, loadToolProfiles } from "../router/tool-profiles.mjs";
import { guardBoundary } from "../boundary/guard.mjs";
import { mustPass } from "../memory/gate.mjs";
import { promote } from "../memory/promotion.mjs";
import { recall } from "../memory/recall.mjs";
import { withYagni } from "../prompts/fragment.mjs";
import { signoff } from "../metrics/signoff.mjs";
import { validateRecord, computeRun, recordRun } from "../metrics/metrics.mjs";

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// --- usage normalization ------------------------------------------------------
// The dispatcher reports `usage`. We turn it into a metrics record WITHOUT
// fabricating token counts: if usage carries no usable token data the record is
// left un-buildable (metrics stays null) rather than invented.

function normalizeTokens(usage) {
  const t = usage.tokens;
  if (t && typeof t === "object" && isFiniteNumber(t.single) && isFiniteNumber(t.multi)) {
    return { single: t.single, multi: t.multi };
  }
  if (isFiniteNumber(t)) {
    // A single total: single == multi (a governed single-agent run is its own
    // baseline). Explicit usage.baseline overrides the single side if present.
    const single = isFiniteNumber(usage.baseline) ? usage.baseline : t;
    return { single, multi: t };
  }
  return null; // no usable token data — do not fabricate
}

function normalizeQuality(usage) {
  const q = usage.quality;
  if (q && typeof q === "object" && isFiniteNumber(q.single) && isFiniteNumber(q.multi)) {
    return { single: q.single, multi: q.multi };
  }
  return { single: 1, multi: 1 }; // neutral, valid default (single > 0 required)
}

function normalizeRetries(usage) {
  const r = usage.retries;
  if (r && typeof r === "object" && Number.isInteger(r.count) && Number.isInteger(r.attempts)) {
    return { count: r.count, attempts: r.attempts };
  }
  return { count: 0, attempts: 1 };
}

/**
 * Build a metrics record from actual usage, or return null if token data is
 * missing (never fabricate). Router overhead stays its own line item.
 */
function buildMetricsRecord({ runId, taskClass, usage, routerOverheadTokens }) {
  const u = usage && typeof usage === "object" ? usage : {};
  const tokens = normalizeTokens(u);
  if (!tokens) return null;
  return {
    runId,
    taskClass,
    tokens,
    quality: normalizeQuality(u),
    retries: normalizeRetries(u),
    routerOverheadTokens,
  };
}

/** Derive the candidate memory to (maybe) promote from the dispatch result. */
function memoryFromResult(result, task) {
  if (task.memory && typeof task.memory === "object") return task.memory;
  const text =
    result && typeof result.text === "string"
      ? result.text
      : typeof result === "string"
        ? result
        : JSON.stringify(result);
  const memory = { text };
  if (typeof task.kind === "string") memory.kind = task.kind;
  if (Array.isArray(task.tags)) memory.tags = task.tags;
  return memory;
}

/**
 * Run a task through the full, enforced coordinator lifecycle.
 *
 * @param {{ id?: string, category?: string, prompt?: string, checks?: Array<{name:string,run:Function}>, context?: any, memory?: object, kind?: string, tags?: string[] }} task
 * @param {{
 *   profile: string,
 *   dispatch?: (args: {plane:string,model:string,tools:string[],prompt:string,category:string}) => ({result:any,usage:any}) | Promise<{result:any,usage:any}>,
 *   adapter?: {add:Function, search:Function},
 *   dryRun?: boolean,
 *   signoffRecords?: object | Array<{class:string,records:object[]}>,
 *   targets?: {tokenReductionPct?:number, qualityDropPct?:number},
 *   logPath?: string,
 *   metrics?: (record: object, opts?: object) => object,
 *   boundaryThreshold?: number,
 *   recall?: {topK?: number, maxTokens?: number},
 * }} opts
 * @returns {Promise<{
 *   plan: {profile:string, category:(string|null), plane:(string|null), model:(string|null), tools:string[], contextTier:string, signedOff:boolean, execution:string, downgraded:boolean, needsJudgment:boolean},
 *   dispatched: boolean,
 *   validated: boolean,
 *   promoted: boolean,
 *   verdict: "ok"|"failed"|"dry-run",
 *   metrics: (object|null),
 *   failures: Array<{name:string, detail?:string}>,
 *   result?: any,
 *   boundary: {tier:string, flagged:boolean, reason:string},
 *   recall?: {used: object[], tokens: number},
 * }>}
 */
export async function runTask(task = {}, opts = {}) {
  // --- 1. load + validate profile / config -----------------------------------
  const { profile } = opts;
  if (!profile || typeof profile !== "string") {
    throw new Error(
      "runTask: opts.profile is required (e.g. 'pure-anthropic' | 'hybrid' | 'open-first')",
    );
  }
  // Loads the profile mapping; throws a clear Error on an unknown profile.
  const mapping = loadConfig(profile);
  const toolProfiles = loadToolProfiles();

  const dryRun = opts.dryRun === true;

  // --- 2. classify / accept task class ---------------------------------------
  const category = typeof task.category === "string" ? task.category : undefined;
  const runId = task.id || `run-${category ?? "unclassified"}`;

  // --- 3. per-class sign-off gate (D17 safe default) -------------------------
  // A class is signed off for multi-agent ONLY when its live metrics meet the
  // acceptance targets. No data / not signed off -> revert to the proven
  // single-agent baseline. We represent the run mode as `execution` and record
  // the downgrade explicitly.
  const signResult = signoff(opts.signoffRecords ?? {}, opts.targets ?? {});
  const signedOff = category != null && signResult.signedOff.includes(category);
  const execution = signedOff ? "multi-agent" : "single-agent";
  const downgraded = !signedOff;

  // --- 4. route -> plane + model (or costed judgment) ------------------------
  const decision = route(task, { profile, config: mapping });
  const needsJudgment = decision.deterministic !== true;
  const plane = needsJudgment ? null : decision.plane;
  const model = needsJudgment ? null : decision.model;
  // Router overhead is its OWN summable line item — NEVER netted against savings.
  const routerOverheadTokens =
    needsJudgment && decision.judgmentCost ? decision.judgmentCost.estimatedTokens ?? 0 : 0;

  // --- 5. tool profile -> worker tool set ------------------------------------
  const tools = piToolArgs(category, { profiles: toolProfiles });

  // --- 6. recall (optional; skipped on dry-run to avoid I/O) -----------------
  let recallResult = { text: "", used: [], tokens: 0 };
  if (!dryRun && opts.adapter) {
    recallResult = await recall(opts.adapter, task.context ?? task.prompt, opts.recall ?? {});
  }

  // --- 7. boundary: nothing full-content crosses unjustified -----------------
  // The content crossing the pane boundary is the injected recall context (or,
  // absent recall, a string `task.context`). Guarded WITHOUT blanket
  // justification so oversized, unjustified content is flagged/downgraded — the
  // whole point of the invariant.
  const crossingContent =
    recallResult.text ||
    (typeof task.context === "string" ? task.context : "");
  const boundary = guardBoundary(
    { tier: "full", content: crossingContent },
    opts.boundaryThreshold != null ? { threshold: opts.boundaryThreshold } : {},
  );
  const contextTier = boundary.tier;
  // Respect the guard's decision on what may cross (possibly truncated content).
  const safeInjection = typeof boundary.content === "string" ? boundary.content : "";

  // Composed worker prompt: bounded recall context + YAGNI fragment + task prompt.
  const workerBody = withYagni(task.prompt ?? "");
  const composedPrompt = safeInjection
    ? `${safeInjection}\n\n${workerBody}`
    : workerBody;

  const plan = {
    profile,
    category: category ?? null,
    plane,
    model,
    tools,
    contextTier,
    signedOff,
    execution,
    downgraded,
    needsJudgment,
  };

  // --- Dry-run: return the plan, invoke NO model, do NO dispatch -------------
  if (dryRun) {
    return {
      plan,
      dispatched: false,
      validated: false,
      promoted: false,
      verdict: "dry-run",
      metrics: null,
      failures: [],
      boundary: { tier: boundary.tier, flagged: boundary.flagged, reason: boundary.reason },
      recall: { used: recallResult.used, tokens: recallResult.tokens },
    };
  }

  // --- 8. DISPATCH via the injected interface --------------------------------
  if (typeof opts.dispatch !== "function") {
    throw new Error(
      "runTask: opts.dispatch is required for a live run. Pass dryRun:true for a plan-only run, " +
        "or inject a dispatcher ({plane,model,tools,prompt,category}) => {result,usage}.",
    );
  }
  const { result, usage } = await opts.dispatch({
    plane,
    model,
    tools,
    prompt: composedPrompt,
    category,
  });

  // --- 9. validate result ----------------------------------------------------
  // On failure the FULL result propagates untouched (never summarized) and is
  // NOT promoted.
  const checks = Array.isArray(task.checks) ? task.checks : [];
  const gate = mustPass(result, checks);
  const validated = gate.passed;

  // --- 10. promote validated keeper into Tier-2 ------------------------------
  let promoted = false;
  if (validated && opts.adapter) {
    const memory = memoryFromResult(result, task);
    const report = await promote([{ memory, checks }], opts.adapter);
    promoted = report.promoted.length > 0;
  }

  // --- 11. metrics / verdict -------------------------------------------------
  const record = buildMetricsRecord({
    runId,
    taskClass: category,
    usage,
    routerOverheadTokens,
  });
  let metrics = null;
  if (record && validateRecord(record).valid) {
    if (typeof opts.metrics === "function") {
      metrics = opts.metrics(record, { logPath: opts.logPath });
    } else if (opts.logPath) {
      metrics = recordRun(record, { logPath: opts.logPath });
    } else {
      metrics = computeRun(record);
    }
  }

  return {
    plan,
    dispatched: true,
    validated,
    promoted,
    verdict: validated ? "ok" : "failed",
    metrics,
    failures: gate.failures,
    result,
    boundary: { tier: boundary.tier, flagged: boundary.flagged, reason: boundary.reason },
    recall: { used: recallResult.used, tokens: recallResult.tokens },
  };
}
