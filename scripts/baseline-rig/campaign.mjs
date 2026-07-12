// Campaign runner — Phase 4 (docs/live-test-plan.md §5, §8, §11).
//
// For each frozen fixture x N trials x {A,B,C}, produce one graded task-run,
// checkpointed after every run (append-only JSONL) so a rate-limit pause or
// crash resumes without repeating or double-spending. Arm order per (fixture,
// trial) is randomized with a fixed recorded seed.
//
//   Arm A (go-pilot): runTask on ikey-hybrid — REAL routing/compression/
//                     validation/metrics; routed model == fixture.armAModel.
//   Arm B (all-Opus naive): raw full prompt -> Opus via Claude CLI, no machinery.
//   Arm C (same-model naive): raw full prompt -> fixture.armAModel, no machinery.
//
// Deterministic grading (exact/unit-test/repo-change) runs inline for an early
// signal; rubric grading is deferred to the blind Phase-5 pass. Zero external
// deps (node builtins + fetch).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runTask } from "../../src/coordinator/run.mjs";
import { resolveModel } from "../../src/config/governance.mjs";
import { createBenchmarkDispatcher, readGatewaySpend, readKey } from "./ikey-dispatch.mjs";
import { createBudgetLedger, estimateCallCost, readSettledSpend } from "../../src/metrics/cost-model.mjs";
import { grade } from "./grader.mjs";
import { loadFixtures, validateManifest } from "./manifest.mjs";
import { mulberry32 } from "../../src/metrics/stats.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.CAMPAIGN_OUT || join(HERE, "out");
const CALIBRATION = JSON.parse(readFileSync(join(HERE, "calibration.json"), "utf8"));

const ARMS = ["A", "B", "C"];
const DETERMINISTIC = new Set(["exact", "unit-test", "repo-change"]);

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Concatenate a fixture's supplied inputs verbatim (the naive-full corpus). */
export function inputsText(fx) {
  return (fx.inputs || []).map((x) => `[${x.name}]\n${x.content}`).join("\n\n");
}

/** The raw naive prompt: task instruction + all inputs, no compression. */
export function naivePrompt(fx) {
  const inp = inputsText(fx);
  return inp ? `${fx.prompt}\n\n${inp}` : fx.prompt;
}

export function runKey(fixtureId, trial, arm) {
  return `${fixtureId}:t${trial}:${arm}`;
}

/** Deterministic 32-bit seed from a string (FNV-1a). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Randomized arm order for a (fixture, trial), deterministic given seed. */
export function armOrderFor(fixtureId, trial, seed) {
  const rand = mulberry32((hashSeed(`${fixtureId}:${trial}`) ^ (seed >>> 0)) >>> 0);
  const arms = [...ARMS];
  for (let i = arms.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arms[i], arms[j]] = [arms[j], arms[i]];
  }
  return arms;
}

/** Full ordered run plan: fixtures x trials, arms in randomized order. */
export function buildRunPlan(fixtures, { trials = 3, seed = 0xC0FFEE } = {}) {
  const plan = [];
  for (const fx of fixtures) {
    for (let trial = 1; trial <= trials; trial += 1) {
      const order = armOrderFor(fx.id, trial, seed);
      order.forEach((arm) => plan.push({ fixtureId: fx.id, trial, arm, armOrder: order.join("") }));
    }
  }
  return plan;
}

/** Filter a plan down to runs not already present in completedKeys. */
export function pendingRuns(plan, completedKeys) {
  return plan.filter((r) => !completedKeys.has(runKey(r.fixtureId, r.trial, r.arm)));
}

/** Read completed run keys from an existing ledger JSONL (for resume). */
export function completedFromLedger(ledgerPath) {
  const done = new Set();
  if (!existsSync(ledgerPath)) return done;
  for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.key) done.add(rec.key);
    } catch { /* ignore partial trailing line */ }
  }
  return done;
}

// ---------------------------------------------------------------------------
// Live execution
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { trials: 3, seed: 0xc0ffee, limit: Infinity, only: null, delayMs: 400, dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--trials") args.trials = Number(argv[++i]);
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--only") args.only = argv[++i].split(",");
    else if (a === "--delay") args.delayMs = Number(argv[++i]);
    else if (a === "--dry") args.dry = true;
  }
  return args;
}

async function runArm(arm, fx, dispatch) {
  const naive = naivePrompt(fx);
  if (arm === "A") {
    const task = { id: runKey(fx.id, 0, "A"), category: fx.category, prompt: fx.prompt, context: inputsText(fx) };
    const res = await runTask(task, {
      profile: "ikey-hybrid",
      dispatch: (req) => dispatch({ ...req, settings: fx.settings }),
      retrieve: false, rules: false, captureWorkspace: false,
    });
    const gatewayModel = resolveModel(res.plan.model).version;
    return {
      output: res.result?.text || "",
      usage: res.usage || {},
      meta: {
        plane: res.plan.plane, model: res.plan.model, provider: res.plan.provider, gatewayModel,
        contextTier: res.plan.contextTier, promptTokens: res.boundary?.promptTokens,
        validated: res.validated, verdict: res.verdict, retries: res.usage?.retries?.count || 0,
      },
    };
  }
  if (arm === "B") {
    const res = await dispatch({ plane: "frontier", model: "opus", prompt: naive, category: fx.category });
    return { output: res.result?.text || "", usage: res.usage || {}, meta: { plane: "frontier", model: "opus", provider: res.usage?.provider, gatewayModel: null } };
  }
  // Arm C: same model as A, naive.
  const res = await dispatch({ plane: "workhorse", model: fx.armAModel, prompt: naive, settings: fx.settings, contract: { maxOutputTokens: fx.settings.max_tokens } });
  return { output: res.result?.text || "", usage: res.usage || {}, meta: { plane: "workhorse", model: fx.armAModel, provider: res.usage?.provider, gatewayModel: resolveModel(fx.armAModel).version } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  const ledgerPath = join(OUT_DIR, "campaign-runs.jsonl");
  const metaPath = join(OUT_DIR, "run-meta.json");
  const summaryPath = join(OUT_DIR, "run-summary.json");

  let fixtures = loadFixtures();
  const manifest = validateManifest(fixtures);
  if (!manifest.ok) { console.error("manifest invalid:", manifest.errors); process.exit(1); }
  if (args.only) fixtures = fixtures.filter((f) => args.only.includes(f.id));

  const plan = buildRunPlan(fixtures, { trials: args.trials, seed: args.seed });
  const completed = completedFromLedger(ledgerPath);
  let pending = pendingRuns(plan, completed);
  if (Number.isFinite(args.limit)) pending = pending.slice(0, args.limit);

  console.error(`Manifest ${manifest.hash.slice(0, 12)} · ${fixtures.length} fixtures · ${args.trials} trials · seed ${args.seed}`);
  console.error(`Plan ${plan.length} runs · ${completed.size} done · ${pending.length} to run this pass${args.dry ? " (DRY)" : ""}`);
  if (args.dry) {
    for (const r of pending.slice(0, 12)) console.error(`  ${runKey(r.fixtureId, r.trial, r.arm)} [order ${r.armOrder}]`);
    if (pending.length > 12) console.error(`  ...+${pending.length - 12} more`);
    return;
  }

  const key = readKey();
  const rates = CALIBRATION.rates;
  const ledger = createBudgetLedger({ rates, caps: { "test/kimi-k2.6": 5, "test/deepseek-v4-pro": 2 }, totalCap: 7 });
  const dispatch = createBenchmarkDispatcher({ key, rates });

  // Baseline cumulative spend recorded once (persisted for resume).
  let meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : null;
  if (!meta) {
    const baseline = await readGatewaySpend(key).catch(() => null);
    meta = { manifestHash: manifest.hash, seed: args.seed, trials: args.trials, baselineSpend: baseline, startedAt: new Date().toISOString() };
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  const byId = Object.fromEntries(fixtures.map((f) => [f.id, f]));
  let done = 0;
  let opusCostUsd = 0;
  const fails = {};

  for (const r of pending) {
    const fx = byId[r.fixtureId];
    const key0 = runKey(r.fixtureId, r.trial, r.arm);
    const rec = { key: key0, fixtureId: fx.id, area: fx.area, areaName: fx.areaName, gradingType: fx.grading.type, arm: r.arm, trial: r.trial, armOrder: r.armOrder, ts: Date.now() };

    // Budget guard for workhorse arms (A routes to workhorse; C is workhorse).
    if (r.arm === "A" || r.arm === "C") {
      const gwModel = resolveModel(fx.armAModel).version;
      const projected = estimateCallCost(gwModel, { total: fx.settings.max_tokens }, rates);
      const check = ledger.wouldExceed(gwModel, projected);
      if (check.blocked) {
        rec.failures = ["budget-skip"]; rec.error = check.reason; rec.score = null;
        appendFileSync(ledgerPath, JSON.stringify(rec) + "\n");
        fails["budget-skip"] = (fails["budget-skip"] || 0) + 1;
        console.error(`  SKIP ${key0}: ${check.reason}`);
        continue;
      }
    }

    try {
      const { output, usage, meta: armMeta } = await runArm(r.arm, fx, dispatch);
      const failures = [];
      if (!output.trim()) failures.push("empty");
      if (usage.finishReason === "length") failures.push("truncated");

      // Account workhorse spend (A + C) toward caps via calibrated estimate.
      if (armMeta.gatewayModel && armMeta.provider === "ikey-gateway") {
        ledger.record({ model: armMeta.gatewayModel, tokens: usage.tokens || {}, costUsd: usage.estCostUsd });
      }
      if (r.arm === "B") opusCostUsd += Number.isFinite(usage.costUsd) ? usage.costUsd : 0;

      // Inline deterministic grade; rubric deferred to Phase 5.
      let gradeResult = null;
      if (DETERMINISTIC.has(fx.grading.type)) {
        gradeResult = await grade(fx, output, {});
        if (gradeResult.failure) failures.push(gradeResult.failure);
      }

      Object.assign(rec, {
        model: armMeta.model, provider: armMeta.provider, gatewayModel: armMeta.gatewayModel, plane: armMeta.plane,
        tokens: usage.tokens || {}, costUsd: usage.costUsd ?? null, estCostUsd: usage.estCostUsd ?? null,
        latencyMs: usage.latencyMs ?? null, finishReason: usage.finishReason ?? null,
        outputChars: output.length, output,
        overhead: r.arm === "A" ? { promptTokens: armMeta.promptTokens, contextTier: armMeta.contextTier, retries: armMeta.retries, validated: armMeta.validated } : null,
        grade: gradeResult, score: gradeResult ? gradeResult.score : null, failures,
      });
      for (const f of failures) fails[f] = (fails[f] || 0) + 1;
      done += 1;
      const scoreStr = gradeResult ? `score=${gradeResult.score}` : "score=deferred";
      console.error(`  ${key0} ${r.arm}->${armMeta.model} tok=${usage.tokens?.total ?? "?"} ${scoreStr}${failures.length ? " FAIL:" + failures.join(",") : ""}`);
    } catch (e) {
      rec.failures = ["error"]; rec.error = String(e.message || e).slice(0, 400); rec.score = null;
      fails["error"] = (fails["error"] || 0) + 1;
      console.error(`  ERROR ${key0}: ${rec.error}`);
    }
    appendFileSync(ledgerPath, JSON.stringify(rec) + "\n");
    if (args.delayMs) await sleep(args.delayMs);
  }

  // Reconcile workhorse spend against settled cumulative delta.
  let settled = null;
  if (meta.baselineSpend != null) {
    const r = await readSettledSpend(() => readGatewaySpend(key), { baseline: meta.baselineSpend, requireMove: false, maxMs: 30000, stableReads: 3 }).catch(() => null);
    settled = r?.settled ?? null;
  }
  const settledDelta = settled != null && meta.baselineSpend != null ? settled - meta.baselineSpend : null;
  const reconciliation = ledger.reconcile(settledDelta);

  const summary = {
    manifestHash: manifest.hash, seed: args.seed, trials: args.trials,
    plannedRuns: plan.length, completedThisPass: done, totalRecords: completedFromLedger(ledgerPath).size,
    failures: fails,
    baselineSpend: meta.baselineSpend, settledSpend: settled, workhorseSettledDelta: settledDelta,
    workhorseEstimate: ledger.totalEstUsd(), workhorsePerModel: ledger.snapshot(), reconciliation,
    opusCostUsd, generatedAt: new Date().toISOString(),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.error(`\nPass complete: ${done} runs. Workhorse est $${ledger.totalEstUsd().toFixed(5)}${settledDelta != null ? ` · settled $${settledDelta.toFixed(5)}` : ""} · Opus $${opusCostUsd.toFixed(4)}`);
  console.error(`Failures: ${JSON.stringify(fails)} · summary -> ${summaryPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("campaign failed:", e.stack || e.message); process.exit(1); });
}
