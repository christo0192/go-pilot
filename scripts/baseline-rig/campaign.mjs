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

/** Stricter repair prompt for a failed/empty/truncated workhorse answer.
 *  Framework-preserving: the SAME workhorse model retries itself — no Opus. */
export function repairPrompt(fx) {
  return [
    naivePrompt(fx),
    "",
    "IMPORTANT: your previous attempt returned no usable answer (it was empty, truncated, or timed out).",
    "Give the COMPLETE final answer DIRECTLY and concisely now. Do not think out loud at length.",
    "If the task asks for JSON, output ONLY valid JSON. If it asks for a boxed number, end with the boxed value.",
  ].join("\n");
}

/** Distinct normalized numeric tokens in a string (commas stripped, % kept).
 *  Used for pack-vs-source grounding and synth-vs-pack preservation checks. */
export function numTokens(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/\d[\d,]*\.?\d*\s*%?/g)) {
    const norm = m[0].replace(/,/g, "").replace(/\s+/g, "").replace(/\.$/, "");
    if (/\d/.test(norm)) out.add(norm);
  }
  return out;
}

/** Fraction of `a`'s numeric tokens also present in `b` (1 if `a` is empty). */
export function numPreservation(a, b) {
  const A = numTokens(a);
  if (!A.size) return 1;
  const B = numTokens(b);
  let hit = 0;
  for (const n of A) if (B.has(n)) hit += 1;
  return hit / A.size;
}

/** Stage-1 (DeepSeek) evidence-pack prompt for the hybrid arm D.
 *  DeepSeek does the expensive reading/extraction/computation; the writer
 *  (Kimi) will see ONLY this pack, never the source. */
export function evidencePrompt(fx) {
  const inp = inputsText(fx);
  return [
    "You are the RESEARCH stage of a two-stage pipeline. Another model will write the final answer using ONLY your notes — it will NOT see the source below. Do NOT write the final answer yourself.",
    "",
    "TASK the writer must eventually satisfy:",
    fx.prompt,
    "",
    inp ? "SOURCE MATERIAL:\n" + inp : "(no source material — this is a generative task; capture the constraints and required facts instead)",
    "",
    "Produce a COMPACT evidence pack the writer can rely on. Use these sections (omit any that don't apply):",
    "- FACTS: every number, name, date, and citation the answer needs — copied EXACTLY, each with a one-phrase label.",
    "- COMPUTED: perform any arithmetic/aggregation the task requires NOW; show the result and how you got it.",
    "- SOURCE SPANS: short verbatim quotes (with any id/label) for claims that must be grounded.",
    "- STRUCTURE: the findings/points/outline the final answer should cover, in order.",
    "- UNCERTAINTY: anything ambiguous, missing, or not answerable from the source — state it plainly.",
    "",
    "Be terse and structured (headings + bullets). Preserve exact values. Do not pad. Target <= 700 tokens.",
  ].join("\n");
}

/** Stage-2 (Kimi) synthesis prompt: writes the final answer from the pack ONLY,
 *  under hard preservation constraints (no re-compute, no invention). */
export function synthPrompt(fx, pack) {
  return [
    "You are the WRITER stage. Write the final answer to the task below using ONLY the evidence pack. You do NOT have the original source.",
    "",
    "HARD RULES:",
    "- Preserve every fact, number, citation, and uncertainty marker from the pack EXACTLY. Do not alter, round, reorder, or omit numbers.",
    "- Do NOT invent, add, or recompute any fact not in the pack. If the pack didn't provide something, do not supply it.",
    "- If the pack marks something uncertain or missing, reflect that faithfully — do not paper over it.",
    "- Follow the task's required format and length exactly.",
    "",
    "TASK:",
    fx.prompt,
    "",
    "EVIDENCE PACK:",
    pack,
    "",
    "Write the polished final answer now. Output only the answer.",
  ].join("\n");
}

/** Sum two usage objects so a repair attempt's tokens/cost are COUNTED, not free. */
export function mergeUsage(a = {}, b = {}) {
  const t = (x) => x?.tokens || {};
  const add = (k) => (Number(t(a)[k]) || 0) + (Number(t(b)[k]) || 0);
  return {
    model: b.model || a.model,
    provider: b.provider || a.provider,
    tokens: { input: add("input"), output: add("output"), reasoning: add("reasoning"), cached: add("cached"), total: add("total") },
    costUsd: (Number(a.costUsd) || 0) + (Number(b.costUsd) || 0),
    estCostUsd: (Number(a.estCostUsd) || 0) + (Number(b.estCostUsd) || 0),
    latencyMs: (Number(a.latencyMs) || 0) + (Number(b.latencyMs) || 0),
    finishReason: b.finishReason || a.finishReason,
  };
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
  const args = { trials: 3, seed: 0xc0ffee, limit: Infinity, only: null, delayMs: 400, dry: false, profile: "ikey-hybrid", cModel: null, arms: null, repair: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--trials") args.trials = Number(argv[++i]);
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--only") args.only = argv[++i].split(",");
    else if (a === "--delay") args.delayMs = Number(argv[++i]);
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--c-model") args.cModel = argv[++i];
    else if (a === "--arms") args.arms = argv[++i].split(",");
    else if (a === "--repair") args.repair = true;
    else if (a === "--dry") args.dry = true;
  }
  return args;
}

async function runArm(arm, fx, dispatch, opts = {}) {
  const naive = naivePrompt(fx);
  const profile = opts.profile || "ikey-hybrid";
  const cModel = opts.cModel || fx.armAModel;
  if (arm === "A") {
    const task = { id: runKey(fx.id, 0, "A"), category: fx.category, prompt: fx.prompt, context: inputsText(fx) };
    let res = null;
    let timedOut = false;
    try {
      res = await runTask(task, {
        profile,
        dispatch: (req) => dispatch({ ...req, settings: fx.settings }),
        // Honor the fixture's declared output budget: the contract default
        // (8000) must never silently undercut a fixture that budgeted more.
        contract: { maxOutputTokens: Math.max(fx.settings.max_tokens || 0, 8000) },
        retrieve: false, rules: false, captureWorkspace: false,
      });
    } catch (e) {
      // With repair on, a timeout/abort is recoverable — retry below. Otherwise rethrow.
      if (opts.repair && /timeout|abort/i.test(String(e.message))) timedOut = true;
      else throw e;
    }
    let output = res?.result?.text || "";
    let usage = res?.usage || {};
    const routedAlias = res?.plan?.model || opts.routedAlias || fx.armAModel;
    const gatewayModel = resolveModel(routedAlias).version;
    let repairUsed = false;
    const truncated = usage.finishReason === "length";
    let repairErrored = false;
    if (opts.repair && (timedOut || !output.trim() || truncated)) {
      // Framework-preserving repair: SAME workhorse model, stricter prompt, generous budget. No Opus.
      let rep = null;
      try {
        rep = await dispatch({
          plane: "workhorse", model: routedAlias, prompt: repairPrompt(fx),
          settings: { ...fx.settings, max_tokens: Math.max(fx.settings.max_tokens || 8000, 16000) },
          contract: { maxOutputTokens: 16000 }, signal: AbortSignal.timeout(300000),
        });
      } catch { repairErrored = true; }
      // A repair attempt is NEVER free (Codex §10): count its tokens even when
      // the answer is unusable, and price an errored attempt at its projected cost.
      if (rep?.usage) usage = mergeUsage(usage, rep.usage);
      if (repairErrored && opts.rates) {
        const proj = estimateCallCost(gatewayModel, { total: 16000 }, opts.rates);
        usage = mergeUsage(usage, { tokens: {}, costUsd: proj, estCostUsd: proj });
      }
      if (rep?.result?.text?.trim()) {
        output = rep.result.text;
        repairUsed = true;
      }
    }
    return {
      output, usage,
      meta: {
        plane: "workhorse", model: routedAlias, provider: usage.provider || "ikey-gateway", gatewayModel,
        contextTier: res?.plan?.contextTier, promptTokens: res?.boundary?.promptTokens,
        validated: res?.validated, verdict: res?.verdict, retries: res?.usage?.retries?.count || 0,
        repairUsed, repairErrored, timedOut,
      },
    };
  }
  if (arm === "D") {
    // Hybrid pipeline (production-shaped):
    //   1. DeepSeek candidate answer   (the fallback + pre-synthesis baseline)
    //   2. DeepSeek evidence pack       (facts/spans/computed/uncertainty)
    //   3. Kimi synthesis from pack ONLY
    // Then VALIDATE the synthesis; if it fails (empty/truncated/drops the pack's
    // numbers) fall back to the DeepSeek candidate. Kimi's tokens/cost are counted
    // either way, but a Kimi failure never becomes an unresolved campaign failure.
    const evModel = opts.evidenceModel || "deepseek-ikey";
    const synthModel = opts.synthModel || "kimi-ikey";
    const evGw = resolveModel(evModel).version;
    const synthGw = resolveModel(synthModel).version;
    const dsCap = Math.max(fx.settings.max_tokens || 8000, 8000);

    // Stage 1: DeepSeek candidate (naive prompt) — this is the fallback answer.
    const candRes = await dispatch({
      plane: "workhorse", model: evModel, prompt: naive,
      settings: { ...fx.settings, max_tokens: dsCap }, contract: { maxOutputTokens: dsCap },
      signal: AbortSignal.timeout(240000),
    }).catch(() => null);
    const candidate = candRes?.result?.text || "";
    const candUsage = candRes?.usage || {};

    // Stage 2: DeepSeek evidence pack.
    const evRes = await dispatch({
      plane: "workhorse", model: evModel, prompt: evidencePrompt(fx),
      settings: { ...fx.settings, max_tokens: 2000 }, contract: { maxOutputTokens: 2000 },
      signal: AbortSignal.timeout(240000),
    }).catch(() => null);
    const pack = evRes?.result?.text || "";
    const evUsage = evRes?.usage || {};

    // Stage 3: Kimi synthesis from the pack only (+ one stricter repair).
    let synth = "";
    let synthUsage = {};
    let synthRepaired = false;
    if (pack.trim()) {
      const sRes = await dispatch({
        plane: "workhorse", model: synthModel, prompt: synthPrompt(fx, pack),
        settings: { ...fx.settings, max_tokens: dsCap }, contract: { maxOutputTokens: dsCap },
        signal: AbortSignal.timeout(300000),
      }).catch(() => null);
      synth = sRes?.result?.text || "";
      synthUsage = sRes?.usage || {};
      if (opts.repair && (!synth.trim() || synthUsage.finishReason === "length")) {
        const rep = await dispatch({
          plane: "workhorse", model: synthModel,
          prompt: synthPrompt(fx, pack) + "\n\nIMPORTANT: your previous attempt was empty or cut off. Give the COMPLETE final answer directly and concisely now.",
          settings: { ...fx.settings, max_tokens: Math.max(dsCap, 16000) }, contract: { maxOutputTokens: Math.max(dsCap, 16000) },
          signal: AbortSignal.timeout(300000),
        }).catch(() => null);
        if (rep?.usage) synthUsage = mergeUsage(synthUsage, rep.usage);
        else if (opts.rates) { const p = estimateCallCost(synthGw, { total: dsCap }, opts.rates); synthUsage = mergeUsage(synthUsage, { tokens: {}, costUsd: p, estCostUsd: p }); }
        if (rep?.result?.text?.trim()) { synth = rep.result.text; synthRepaired = true; }
      }
    }

    // Validate the synthesis. numPreserved = fraction of the pack's numbers that
    // survive into the synthesis (drift guard). packGrounding = fraction of the
    // pack's numbers actually present in the SOURCE (truth guard, diagnostic).
    const synthTruncated = synthUsage.finishReason === "length";
    const synthEmpty = !synth.trim();
    const numPreserved = numPreservation(pack, synth);
    const packGrounding = numPreservation(pack, inputsText(fx));
    const synthValid = !synthEmpty && !synthTruncated && numPreserved >= 0.8;

    // Fallback: use the synthesis only when valid; else the DeepSeek candidate.
    const usedFallback = !synthValid;
    const output = synthValid ? synth : candidate;

    // ALL three legs are real pipeline cost — count every one.
    const usage = mergeUsage(mergeUsage(candUsage, evUsage), synthUsage);
    usage.finishReason = usedFallback ? candUsage.finishReason : synthUsage.finishReason;
    return {
      output, usage,
      meta: {
        plane: "workhorse", model: usedFallback ? `${evModel}(fallback)` : `${evModel}->${synthModel}`,
        provider: "ikey-gateway", gatewayModel: usedFallback ? evGw : synthGw,
        stages: [
          { stage: "candidate", model: evGw, tokens: candUsage.tokens || {}, costUsd: candUsage.estCostUsd ?? candUsage.costUsd },
          { stage: "evidence", model: evGw, tokens: evUsage.tokens || {}, costUsd: evUsage.estCostUsd ?? evUsage.costUsd },
          { stage: "synth", model: synthGw, tokens: synthUsage.tokens || {}, costUsd: synthUsage.estCostUsd ?? synthUsage.costUsd },
        ],
        candidate, pack, packChars: pack.length,
        usedFallback, synthValid, synthEmpty, synthTruncated, synthRepaired,
        numPreserved, packGrounding,
        repairUsed: synthRepaired,
      },
    };
  }
  if (arm === "B") {
    const res = await dispatch({ plane: "frontier", model: "opus", prompt: naive, category: fx.category });
    return { output: res.result?.text || "", usage: res.usage || {}, meta: { plane: "frontier", model: "opus", provider: res.usage?.provider, gatewayModel: null } };
  }
  // Arm C: same model as A, naive.
  const res = await dispatch({ plane: "workhorse", model: cModel, prompt: naive, settings: fx.settings, contract: { maxOutputTokens: fx.settings.max_tokens } });
  return { output: res.result?.text || "", usage: res.usage || {}, meta: { plane: "workhorse", model: cModel, provider: res.usage?.provider, gatewayModel: resolveModel(cModel).version } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  const ledgerPath = join(OUT_DIR, "campaign-runs.jsonl");
  const metaPath = join(OUT_DIR, "run-meta.json");
  const summaryPath = join(OUT_DIR, "run-summary.json");

  let fixtures = loadFixtures();
  // When Arm A runs on a non-default profile or Arm C uses an override model, the
  // fixture's declared armAModel is intentionally NOT the routed model (model-swap
  // experiment), so skip the armAModel-match assertion.
  const swap = args.profile !== "ikey-hybrid" || args.cModel != null;
  const manifest = validateManifest(fixtures, { profile: args.profile, checkArmModel: !swap });
  if (!manifest.ok) { console.error("manifest invalid:", manifest.errors); process.exit(1); }
  if (args.only) fixtures = fixtures.filter((f) => args.only.includes(f.id));

  const plan = buildRunPlan(fixtures, { trials: args.trials, seed: args.seed });
  // Arm D (hybrid DeepSeek->Kimi) is additive and not part of the tested A/B/C
  // permutation — append its runs directly so buildRunPlan/ARMS stay frozen.
  if (args.arms && args.arms.includes("D")) {
    for (const fx of fixtures) {
      for (let trial = 1; trial <= args.trials; trial += 1) plan.push({ fixtureId: fx.id, trial, arm: "D", armOrder: "D" });
    }
  }
  const completed = completedFromLedger(ledgerPath);
  let pending = pendingRuns(plan, completed);
  if (args.arms) pending = pending.filter((r) => args.arms.includes(r.arm));
  if (Number.isFinite(args.limit)) pending = pending.slice(0, args.limit);

  // Profile route lookup for the Arm-A budget guard (before runTask resolves it).
  const routerCfg = JSON.parse(readFileSync(join(HERE, "..", "..", "config", "router.json"), "utf8"));
  const profileCats = routerCfg[args.profile]?.categories || {};

  console.error(`Manifest ${manifest.hash.slice(0, 12)} · profile ${args.profile}${args.cModel ? ` · C=${args.cModel}` : ""}${args.arms ? ` · arms ${args.arms.join("")}` : ""} · ${fixtures.length} fixtures · ${args.trials} trials · seed ${args.seed}`);
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
  let fallbacks = 0;
  const fails = {};

  for (const r of pending) {
    const fx = byId[r.fixtureId];
    const key0 = runKey(r.fixtureId, r.trial, r.arm);
    const rec = { key: key0, fixtureId: fx.id, area: fx.area, areaName: fx.areaName, gradingType: fx.grading.type, arm: r.arm, trial: r.trial, armOrder: r.armOrder, ts: Date.now() };

    // Budget guard for workhorse arms (A routes to workhorse; C is workhorse;
    // D is a DeepSeek evidence call + a Kimi synth call — guard the pricier Kimi leg).
    if (r.arm === "A" || r.arm === "C" || r.arm === "D") {
      const armAlias = r.arm === "A" ? (profileCats[fx.category]?.model || fx.armAModel)
        : r.arm === "D" ? "kimi-ikey"
          : (args.cModel || fx.armAModel);
      const gwModel = resolveModel(armAlias).version;
      const projTokens = r.arm === "D" ? Math.max(fx.settings.max_tokens || 8000, 8000) : fx.settings.max_tokens;
      const projected = estimateCallCost(gwModel, { total: projTokens }, rates);
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
      const routedAlias = profileCats[fx.category]?.model || fx.armAModel;
      const { output, usage, meta: armMeta } = await runArm(r.arm, fx, dispatch, { profile: args.profile, cModel: args.cModel, repair: args.repair, routedAlias, rates });
      const failures = [];
      if (!output.trim()) failures.push("empty");
      if (usage.finishReason === "length") failures.push("truncated");

      // Account workhorse spend toward caps via calibrated estimate. Arm D has
      // two workhorse legs — record each stage against its own model.
      if (r.arm === "D" && Array.isArray(armMeta.stages)) {
        for (const st of armMeta.stages) ledger.record({ model: st.model, tokens: st.tokens || {}, costUsd: st.costUsd });
      } else if (armMeta.gatewayModel && armMeta.provider === "ikey-gateway") {
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
        repairUsed: armMeta.repairUsed || false, repairErrored: armMeta.repairErrored || false,
        stages: armMeta.stages || null, packChars: armMeta.packChars ?? null,
        grade: gradeResult, score: gradeResult ? gradeResult.score : null, failures,
      });
      // Hybrid (arm D): retain the pack + fallback/validation diagnostics, and
      // emit a companion `Dcand` record holding the pre-synthesis DeepSeek
      // candidate so the paired candidate-vs-synthesis delta can be graded.
      if (r.arm === "D") {
        rec.hybrid = {
          usedFallback: armMeta.usedFallback, synthValid: armMeta.synthValid,
          synthEmpty: armMeta.synthEmpty, synthTruncated: armMeta.synthTruncated,
          synthRepaired: armMeta.synthRepaired,
          numPreserved: armMeta.numPreserved, packGrounding: armMeta.packGrounding,
        };
        rec.pack = armMeta.pack;
        if (armMeta.usedFallback) fallbacks += 1;
        const candRec = {
          key: runKey(fx.id, r.trial, "Dcand"), fixtureId: fx.id, area: fx.area, areaName: fx.areaName,
          gradingType: fx.grading.type, arm: "Dcand", trial: r.trial, armOrder: "Dcand", ts: Date.now(),
          model: "deepseek-ikey", provider: "ikey-gateway", plane: "workhorse",
          outputChars: (armMeta.candidate || "").length, output: armMeta.candidate || "",
          failures: (armMeta.candidate || "").trim() ? [] : ["empty"],
        };
        appendFileSync(ledgerPath, JSON.stringify(candRec) + "\n");
      }
      for (const f of failures) fails[f] = (fails[f] || 0) + 1;
      done += 1;
      const scoreStr = gradeResult ? `score=${gradeResult.score}` : "score=deferred";
      const fbStr = r.arm === "D" ? (armMeta.usedFallback ? " [FALLBACK->ds]" : ` [synth ok, numPres=${(armMeta.numPreserved ?? 1).toFixed(2)}]`) : "";
      console.error(`  ${key0} ${r.arm}->${armMeta.model} tok=${usage.tokens?.total ?? "?"} ${scoreStr}${armMeta.repairUsed ? " [repaired]" : ""}${fbStr}${failures.length ? " FAIL:" + failures.join(",") : ""}`);
    } catch (e) {
      rec.failures = ["error"]; rec.error = String(e.message || e).slice(0, 400); rec.score = null;
      // Failed attempts are NOT free (Codex §10): count the projected workhorse
      // spend toward caps and record it so aggregation prices the failure.
      if (r.arm !== "B") {
        try {
          const failAlias = r.arm === "A" ? (profileCats[fx.category]?.model || fx.armAModel) : (args.cModel || fx.armAModel);
          const failModel = resolveModel(failAlias).version;
          const projected = estimateCallCost(failModel, { total: fx.settings.max_tokens }, rates);
          rec.projectedCostUsd = projected;
          ledger.record({ model: failModel, tokens: {}, costUsd: projected });
        } catch { /* projection is best-effort */ }
      }
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
    failures: fails, hybridFallbacks: fallbacks,
    baselineSpend: meta.baselineSpend, settledSpend: settled, workhorseSettledDelta: settledDelta,
    workhorseEstimate: ledger.totalEstUsd(), workhorsePerModel: ledger.snapshot(), reconciliation,
    opusCostUsd, generatedAt: new Date().toISOString(),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.error(`\nPass complete: ${done} runs. Workhorse est $${ledger.totalEstUsd().toFixed(5)}${settledDelta != null ? ` · settled $${settledDelta.toFixed(5)}` : ""} · Opus $${opusCostUsd.toFixed(4)}`);
  console.error(`Failures: ${JSON.stringify(fails)}${fallbacks ? ` · Kimi->DS fallbacks: ${fallbacks}` : ""} · summary -> ${summaryPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("campaign failed:", e.stack || e.message); process.exit(1); });
}
