// Aggregation + report — Phase 6 (docs/live-test-plan.md §9, §10).
//
// Joins graded-runs.jsonl (finalScore + judges) to campaign-runs.jsonl
// (tokens/cost/latency/failures), computes per-fixture trial medians, rolls up
// per-area and overall per arm, runs bootstrap CIs on the WITH-vs-WITHOUT
// deltas, applies the pre-registered §2 gates, and writes
// docs/live-test-results.md. Zero external deps.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadFixtures } from "./manifest.mjs";
import { median, mean, p75, p95, bootstrapCI } from "../../src/metrics/stats.mjs";
import { estimateCallCost } from "../../src/metrics/cost-model.mjs";
import { resolveModel } from "../../src/config/governance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.CAMPAIGN_OUT || join(HERE, "out");
const CALIBRATION = JSON.parse(readFileSync(join(HERE, "calibration.json"), "utf8"));
const REPORT_PATH = process.env.REPORT_PATH || resolve(HERE, "..", "..", "docs", "live-test-results-v3.md");

const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);

// Effective per-run workhorse cost from calibrated rate x tokens (Opus uses its
// reported total_cost_usd). Failed attempts carry their projected cost — not free.
function runCostUsd(rec) {
  if (Number.isFinite(rec.projectedCostUsd) && !rec.tokens?.total) return rec.projectedCostUsd;
  if (rec.provider === "anthropic-cli") return Number.isFinite(rec.costUsd) ? rec.costUsd : 0;
  if (rec.gatewayModel) return estimateCallCost(rec.gatewayModel, rec.tokens || {}, CALIBRATION.rates);
  return Number.isFinite(rec.costUsd) ? rec.costUsd : 0;
}

// B2 "lean Opus" — ANALYTIC derivation from B runs (Codex §10): the Claude CLI
// reports input/output tokens EXCLUDING the cached system-prompt tax, so B's
// recorded tokens already are the lean token count; B2 cost = bare Opus API
// rates on those tokens. Quality is identical to B by construction (same model,
// same prompt, same output). B1 cost = CLI total_cost_usd (includes the tax).
function b2CostUsd(rec) {
  const r = CALIBRATION.opus?.apiRates || { inPerM: 5, outPerM: 25 };
  const t = rec.tokens || {};
  return ((t.input || 0) * r.inPerM + (t.output || 0) * r.outPerM) / 1e6;
}

// v3 reliability metrics per arm, computed from RAW runs (not medians).
// success = graded with a real score and no hard failures.
function armReliability(runs, costFn) {
  const attempts = runs.length;
  const hardFail = (r) => (r.failures || []).some((f) => ["empty", "timeout", "truncated", "error", "budget-skip"].includes(f));
  const successes = runs.filter((r) => Number.isFinite(r.finalScore) && r.finalScore > 0 && !hardFail(r));
  const successRate = attempts ? successes.length / attempts : NaN;
  const qWhenCompleted = successes.length ? mean(successes.map((r) => r.finalScore)) : NaN;
  const raq = Number.isFinite(qWhenCompleted) && Number.isFinite(successRate) ? qWhenCompleted * successRate : NaN;
  const totalCost = runs.reduce((a, r) => a + (costFn(r) || 0), 0);
  const totalTokens = runs.reduce((a, r) => a + (r.tokens?.total || 0), 0);
  const cachedTokens = runs.reduce((a, r) => a + (r.tokens?.cached || r.tokens?.cacheRead || 0), 0);
  const freshInput = runs.reduce((a, r) => a + (r.tokens?.input || 0), 0);
  return {
    attempts, successes: successes.length, successRate,
    cachedTokens,
    cacheHitPct: freshInput + cachedTokens > 0 ? (100 * cachedTokens) / (freshInput + cachedTokens) : 0,
    qualityWhenCompleted: qWhenCompleted, reliabilityAdjustedQuality: raq,
    totalCostUsd: totalCost, totalTokens,
    costPerSuccess: successes.length ? totalCost / successes.length : NaN,
    tokensPerSuccess: successes.length ? totalTokens / successes.length : NaN,
    qualityPerDollar: totalCost > 0 && Number.isFinite(raq) ? raq / totalCost : NaN,
    qualityPer1kTokens: totalTokens > 0 && Number.isFinite(raq) ? raq / (totalTokens / 1000) : NaN,
  };
}

// Median over trials of a per-(fixture,arm) metric selector.
function fixtureArmMedian(records, selector) {
  const vals = records.map(selector).filter((v) => Number.isFinite(v));
  return vals.length ? median(vals) : NaN;
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");

function main() {
  const runs = readJsonl(join(OUT_DIR, "campaign-runs.jsonl"));
  const graded = new Map(readJsonl(join(OUT_DIR, "graded-runs.jsonl")).map((g) => [g.key, g]));
  const meta = existsSync(join(OUT_DIR, "run-meta.json")) ? JSON.parse(readFileSync(join(OUT_DIR, "run-meta.json"), "utf8")) : {};
  const runSummary = existsSync(join(OUT_DIR, "run-summary.json")) ? JSON.parse(readFileSync(join(OUT_DIR, "run-summary.json"), "utf8")) : {};
  const gradeSummary = existsSync(join(OUT_DIR, "grade-summary.json")) ? JSON.parse(readFileSync(join(OUT_DIR, "grade-summary.json"), "utf8")) : {};
  const fixtures = loadFixtures();
  const fxById = Object.fromEntries(fixtures.map((f) => [f.id, f]));

  // Attach finalScore to each run; index by fixture -> arm -> [records].
  const idx = {};
  const failureBoard = { A: {}, B: {}, C: {} };
  for (const r of runs) {
    const g = graded.get(r.key);
    r.finalScore = g ? g.finalScore : r.score;
    (idx[r.fixtureId] ||= { A: [], B: [], C: [] })[r.arm].push(r);
    for (const f of r.failures || []) failureBoard[r.arm][f] = (failureBoard[r.arm][f] || 0) + 1;
  }

  const ARMS = ["A", "B", "C"];
  // Per-fixture, per-arm trial medians.
  const perFixture = {};
  for (const fx of fixtures) {
    const recs = idx[fx.id];
    if (!recs) continue;
    perFixture[fx.id] = { area: fx.area, areaName: fx.areaName };
    for (const arm of ARMS) {
      const rs = recs[arm] || [];
      perFixture[fx.id][arm] = {
        quality: fixtureArmMedian(rs, (r) => r.finalScore),
        totalTokens: fixtureArmMedian(rs, (r) => r.tokens?.total),
        inputTokens: fixtureArmMedian(rs, (r) => r.tokens?.input),
        outputTokens: fixtureArmMedian(rs, (r) => r.tokens?.output),
        costUsd: fixtureArmMedian(rs, (r) => runCostUsd(r)),
        latencyMs: fixtureArmMedian(rs, (r) => r.latencyMs),
        n: rs.length,
      };
    }
  }

  // Roll up to areas + overall. Quality = mean of fixture medians; tokens/cost = sum.
  const areas = [...new Set(fixtures.map((f) => f.area))].sort((a, b) => a - b);
  const byArea = {};
  for (const area of areas) {
    const fxIds = fixtures.filter((f) => f.area === area).map((f) => f.id).filter((id) => perFixture[id]);
    byArea[area] = { areaName: fixtures.find((f) => f.area === area)?.areaName, fixtures: fxIds };
    for (const arm of ARMS) {
      const q = fxIds.map((id) => perFixture[id][arm].quality).filter(Number.isFinite);
      const tok = fxIds.map((id) => perFixture[id][arm].totalTokens).filter(Number.isFinite);
      const cost = fxIds.map((id) => perFixture[id][arm].costUsd).filter(Number.isFinite);
      byArea[area][arm] = {
        quality: q.length ? mean(q) : NaN,
        totalTokens: tok.reduce((a, b) => a + b, 0),
        costUsd: cost.reduce((a, b) => a + b, 0),
      };
    }
  }

  // Overall per arm.
  const overall = {};
  for (const arm of ARMS) {
    const ids = Object.keys(perFixture);
    const q = ids.map((id) => perFixture[id][arm].quality).filter(Number.isFinite);
    overall[arm] = {
      quality: q.length ? mean(q) : NaN,
      totalTokens: ids.map((id) => perFixture[id][arm].totalTokens).filter(Number.isFinite).reduce((a, b) => a + b, 0),
      inputTokens: ids.map((id) => perFixture[id][arm].inputTokens).filter(Number.isFinite).reduce((a, b) => a + b, 0),
      costUsd: ids.map((id) => perFixture[id][arm].costUsd).filter(Number.isFinite).reduce((a, b) => a + b, 0),
    };
  }

  // v3: reliability metrics from raw runs + the derived B2 lean-Opus arm.
  const rawByArm = { A: [], B: [], C: [] };
  for (const r of runs) if (rawByArm[r.arm]) rawByArm[r.arm].push(r);
  const v3 = {
    A: armReliability(rawByArm.A, runCostUsd),
    B: armReliability(rawByArm.B, runCostUsd),
    B2: armReliability(rawByArm.B, b2CostUsd), // same runs/quality, lean API-rate cost
    C: armReliability(rawByArm.C, runCostUsd),
  };
  // §11 pass gates (pre-registered).
  const v3gates = {
    meanQuality98: Number.isFinite(v3.A.qualityWhenCompleted) && v3.A.qualityWhenCompleted >= 98,
    raq96: Number.isFinite(v3.A.reliabilityAdjustedQuality) && v3.A.reliabilityAdjustedQuality >= 96,
    cost80vsB2: Number.isFinite(v3.A.costPerSuccess) && Number.isFinite(v3.B2.costPerSuccess) && v3.B2.costPerSuccess > 0
      && v3.A.costPerSuccess <= 0.20 * v3.B2.costPerSuccess,
    qp1kBeatsC: Number.isFinite(v3.A.qualityPer1kTokens) && Number.isFinite(v3.C.qualityPer1kTokens)
      && v3.A.qualityPer1kTokens > v3.C.qualityPer1kTokens,
    zeroUnresolved: (rawByArm.A.filter((r) => (r.failures || []).some((f) => ["empty", "timeout"].includes(f)))).length === 0,
  };

  // Bootstrap CI over fixtures for the WITH-vs-WITHOUT ratio deltas.
  const ids = Object.keys(perFixture);
  function ratioCI(numSel, denSel, seed) {
    const pairs = ids.map((id) => [numSel(perFixture[id]), denSel(perFixture[id])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > 0);
    if (!pairs.length) return { point: NaN, lo: NaN, hi: NaN };
    // statistic = sum(num)/sum(den) over a resample of fixtures.
    const idxArr = pairs.map((_, i) => i);
    const stat = (sample) => {
      let n = 0, d = 0;
      for (const i of sample) { n += pairs[i][0]; d += pairs[i][1]; }
      return d ? n / d : NaN;
    };
    return bootstrapCI(idxArr, { statistic: stat, seed, resamples: 2000 });
  }

  const costA_vs_B = ratioCI((f) => f.A.costUsd, (f) => f.B.costUsd, 101);
  const tokA_vs_B = ratioCI((f) => f.A.totalTokens, (f) => f.B.totalTokens, 102);
  const tokA_vs_C = ratioCI((f) => f.A.totalTokens, (f) => f.C.totalTokens, 103);
  const qualA_vs_B = ratioCI((f) => f.A.quality, (f) => f.B.quality, 104);

  // Per-area §2 gate verdicts.
  const gates = {};
  for (const area of areas) {
    const a = byArea[area].A, b = byArea[area].B, c = byArea[area].C;
    const qualFloor = Number.isFinite(a.quality) && Number.isFinite(b.quality) && b.quality > 0 ? a.quality >= 0.95 * b.quality : false;
    const costEff = Number.isFinite(a.costUsd) && Number.isFinite(b.costUsd) && b.costUsd > 0 ? a.costUsd <= 0.60 * b.costUsd : false;
    const tokenEff = Number.isFinite(a.totalTokens) && Number.isFinite(c.totalTokens) ? a.totalTokens < c.totalTokens : false;
    gates[area] = { qualFloor, costEff, tokenEff, pass: qualFloor && costEff && tokenEff };
  }

  // Judge reliability: Pearson correlation between Opus/DeepSeek overalls.
  const judgePairs = [];
  for (const g of graded.values()) {
    if (g.judges?.opus?.overall != null && g.judges?.deepseek?.overall != null) judgePairs.push([g.judges.opus.overall, g.judges.deepseek.overall]);
  }
  function pearson(ps) {
    const n = ps.length; if (n < 2) return NaN;
    const mx = mean(ps.map((p) => p[0])), my = mean(ps.map((p) => p[1]));
    let sxy = 0, sxx = 0, syy = 0;
    for (const [x, y] of ps) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
  }
  const judgeCorr = pearson(judgePairs);

  const report = renderReport({ meta, runSummary, gradeSummary, overall, byArea, perFixture, fxById, gates, v3, v3gates, deltas: { costA_vs_B, tokA_vs_B, tokA_vs_C, qualA_vs_B }, failureBoard, judge: { corr: judgeCorr, pairs: judgePairs.length, disagreements: gradeSummary.rubricDisagreements, meanMaxDelta: gradeSummary.meanMaxDelta } });
  writeFileSync(REPORT_PATH, report);
  console.error(`Report written -> ${REPORT_PATH} (${runs.length} runs, ${graded.size} graded)`);
}

function renderV3(v3, g) {
  const L = [];
  L.push("## v3 scorecard — reliability-adjusted (raw runs, Opus-only judge)\n");
  L.push("B2 = lean-Opus baseline, derived analytically from B: same runs and quality; cost at bare Opus API rates on the CLI-reported (cache-exclusive) tokens. B1 cost includes the measured ~65k-token Claude-Code session tax.\n");
  L.push("| Metric | A (go-pilot) | B1 (Claude-Code Opus) | B2 (lean Opus) | C (naive) |");
  L.push("|---|--:|--:|--:|--:|");
  const row = (label, k, dec = 2) => L.push(`| ${label} | ${fmt(v3.A[k], dec)} | ${fmt(v3.B[k], dec)} | ${fmt(v3.B2[k], dec)} | ${fmt(v3.C[k], dec)} |`);
  L.push(`| Attempts / successes | ${v3.A.attempts}/${v3.A.successes} | ${v3.B.attempts}/${v3.B.successes} | ${v3.B2.attempts}/${v3.B2.successes} | ${v3.C.attempts}/${v3.C.successes} |`);
  row("Success rate", "successRate", 3);
  row("Quality when completed", "qualityWhenCompleted", 1);
  row("Reliability-adjusted quality", "reliabilityAdjustedQuality", 1);
  row("Total cost $", "totalCostUsd", 4);
  row("Cost per success $", "costPerSuccess", 4);
  row("Tokens per success", "tokensPerSuccess", 0);
  row("Cached tokens (provider cache hits)", "cachedTokens", 0);
  row("Cache hit % of input", "cacheHitPct", 1);
  row("Quality per $ ", "qualityPerDollar", 1);
  row("Quality per 1k tokens", "qualityPer1kTokens", 2);
  L.push("");
  L.push("**§11 pass gates:**\n");
  L.push(`- A mean quality ≥ 98: ${g.meanQuality98 ? "✅" : "❌"}`);
  L.push(`- A reliability-adjusted quality ≥ 96: ${g.raq96 ? "✅" : "❌"}`);
  L.push(`- A cost/success ≤ 20% of B2 (≥80% cheaper): ${g.cost80vsB2 ? "✅" : "❌"}`);
  L.push(`- A beats C on quality-per-1k-tokens: ${g.qp1kBeatsC ? "✅" : "❌"}`);
  L.push(`- Zero unresolved empties/timeouts in A: ${g.zeroUnresolved ? "✅" : "❌"}`);
  L.push("");
  return L;
}

function renderReport(d) {
  const { meta, runSummary, gradeSummary, overall, byArea, perFixture, fxById, gates, v3, v3gates, deltas, failureBoard, judge } = d;
  const L = [];
  const arm = (x) => ({ A: "A (go-pilot)", B: "B (all-Opus)", C: "C (same-model naive)" }[x]);
  const opusCost = runSummary.opusCostUsd || 0;
  // Cost per arm: A/C from calibrated workhorse est (overall.costUsd), B from Opus.
  const costPerArm = { A: overall.A.costUsd, B: overall.B.costUsd, C: overall.C.costUsd };

  L.push("# Go-pilot Live Test — Results\n");
  L.push(`_Generated ${new Date().toISOString()}. Directional efficiency proof on a frozen sample (see docs/live-test-plan.md §0 for scope)._\n`);
  L.push("## Reproducibility header\n");
  L.push(`- **Manifest hash:** \`${meta.manifestHash || runSummary.manifestHash || "n/a"}\``);
  L.push(`- **Seed:** ${meta.seed ?? "n/a"} · **Trials:** ${meta.trials ?? "n/a"}`);
  L.push(`- **Workhorse rates (calibrated):** kimi-k2.6 $${CALIBRATION.rates["test/kimi-k2.6"].perMillionTotal}/M · deepseek-v4-pro $${CALIBRATION.rates["test/deepseek-v4-pro"].perMillionTotal}/M total tokens`);
  L.push(`- **Workhorse spend:** est $${fmt(runSummary.workhorseEstimate, 5)} · settled $${fmt(runSummary.workhorseSettledDelta, 5)} (reconcile scale ${fmt(runSummary.reconciliation?.scale, 3)})`);
  L.push(`- **Opus (Arm B) cost @ API rates:** $${fmt(opusCost, 4)} — includes the ~49k Claude-Code system-prompt tax per call (D32), low reasoning effort.`);
  L.push(`- **Judge tokens:** Opus ${gradeSummary.judgeTokens?.opus ?? "n/a"} · DeepSeek ${gradeSummary.judgeTokens?.deepseek ?? "n/a"}\n`);

  if (v3) L.push(...renderV3(v3, v3gates));

  L.push("## Headline — WITH (Arm A) vs WITHOUT\n");
  L.push("| Metric | A (go-pilot) | B (all-Opus) | C (same-model naive) |");
  L.push("|---|--:|--:|--:|");
  L.push(`| Mean quality (0-100) | ${fmt(overall.A.quality, 1)} | ${fmt(overall.B.quality, 1)} | ${fmt(overall.C.quality, 1)} |`);
  L.push(`| Total tokens (Σ fixture medians) | ${overall.A.totalTokens} | ${overall.B.totalTokens} | ${overall.C.totalTokens} |`);
  L.push(`| Total cost $ | ${fmt(costPerArm.A, 4)} | ${fmt(costPerArm.B, 4)} | ${fmt(costPerArm.C, 4)} |\n`);
  const cr = deltas.costA_vs_B, tb = deltas.tokA_vs_B, tc = deltas.tokA_vs_C, ql = deltas.qualA_vs_B;
  L.push("**Deltas (bootstrap 95% CI over fixtures):**\n");
  L.push(`- **Cost A vs B:** A is ${pct(1 - cr.point)} cheaper (ratio ${fmt(cr.point, 3)}, CI [${fmt(cr.lo, 3)}, ${fmt(cr.hi, 3)}])`);
  L.push(`- **Tokens A vs B:** ${pct(1 - tb.point)} fewer (ratio ${fmt(tb.point, 3)}, CI [${fmt(tb.lo, 3)}, ${fmt(tb.hi, 3)}])`);
  L.push(`- **Tokens A vs C (compression only):** ratio ${fmt(tc.point, 3)}, CI [${fmt(tc.lo, 3)}, ${fmt(tc.hi, 3)}]`);
  L.push(`- **Quality A vs B:** ratio ${fmt(ql.point, 3)}, CI [${fmt(ql.lo, 3)}, ${fmt(ql.hi, 3)}] (1.0 = parity)\n`);

  L.push("## Per-area verdicts vs pre-registered §2 gates\n");
  L.push("Gate = quality A ≥ 95% of B **and** cost A ≤ 60% of B **and** tokens A < tokens C.\n");
  L.push("| Area | qA | qB | qC | $A | $B | tokA | tokC | qFloor | costEff | tokEff | Verdict |");
  L.push("|---|--:|--:|--:|--:|--:|--:|--:|:-:|:-:|:-:|:-:|");
  for (const area of Object.keys(byArea).map(Number).sort((a, b) => a - b)) {
    const x = byArea[area], g = gates[area];
    L.push(`| ${area} ${x.areaName} | ${fmt(x.A.quality, 1)} | ${fmt(x.B.quality, 1)} | ${fmt(x.C.quality, 1)} | ${fmt(x.A.costUsd, 4)} | ${fmt(x.B.costUsd, 4)} | ${x.A.totalTokens} | ${x.C.totalTokens} | ${g.qualFloor ? "✅" : "❌"} | ${g.costEff ? "✅" : "❌"} | ${g.tokenEff ? "✅" : "❌"} | ${g.pass ? "**WIN**" : "keep-on-Opus"} |`);
  }
  L.push("");

  L.push("## Overhead ledger (Arm A machinery, reported separately)\n");
  const aInput = overall.A.inputTokens, cInput = Object.keys(perFixture).map((id) => perFixture[id].C.inputTokens).filter(Number.isFinite).reduce((a, b) => a + b, 0);
  L.push(`- **Input-token delta A vs C (scaffolding − compression):** ${aInput - cInput} (A ${aInput} vs C ${cInput}). Positive = net scaffolding overhead; negative = net compression saving.`);
  L.push(`- **Judge tokens (campaign-level):** Opus ${gradeSummary.judgeTokens?.opus ?? 0} + DeepSeek ${gradeSummary.judgeTokens?.deepseek ?? 0}.`);
  L.push(`- **DeepSeek judge est cost:** $${fmt(gradeSummary.judgeDeepseekEstUsd, 5)}.\n`);

  L.push("## Failure scoreboard (counts per arm)\n");
  L.push("| Failure | A | B | C |");
  L.push("|---|--:|--:|--:|");
  const failTypes = [...new Set([...Object.keys(failureBoard.A), ...Object.keys(failureBoard.B), ...Object.keys(failureBoard.C)])];
  if (failTypes.length === 0) L.push("| _(none)_ | 0 | 0 | 0 |");
  for (const t of failTypes) L.push(`| ${t} | ${failureBoard.A[t] || 0} | ${failureBoard.B[t] || 0} | ${failureBoard.C[t] || 0} |`);
  L.push("");

  L.push("## Judge reliability\n");
  L.push(`- Inter-judge Pearson correlation (Opus vs DeepSeek overall): **${fmt(judge.corr, 3)}** over ${judge.pairs} rubric outputs.`);
  L.push(`- Flagged disagreements (|Δ| ≥ 2 on any dimension): **${judge.disagreements ?? "n/a"}** · mean max-Δ ${fmt(judge.meanMaxDelta, 2)}.\n`);

  L.push("## Per-fixture detail (trial medians)\n");
  L.push("| Fixture | Area | qA | qB | qC | tokA | tokB | tokC | $A | $B | $C |");
  L.push("|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const id of Object.keys(perFixture).sort()) {
    const f = perFixture[id];
    L.push(`| ${id} | ${f.areaName} | ${fmt(f.A.quality, 0)} | ${fmt(f.B.quality, 0)} | ${fmt(f.C.quality, 0)} | ${f.A.totalTokens} | ${f.B.totalTokens} | ${f.C.totalTokens} | ${fmt(f.A.costUsd, 4)} | ${fmt(f.B.costUsd, 4)} | ${fmt(f.C.costUsd, 4)} |`);
  }
  L.push("");

  L.push("## Honesty section\n");
  L.push("- Single-campaign, frozen 28-task sample × N trials — **directional**, not a production-grade \"consistently better\" claim (needs many-repo soak).");
  L.push("- **Single-shot, not the live herdr+Pi agentic loop.** Each arm is one text-in→text-out call through the real governed coordinator (`runTask`); it does NOT run the multi-turn tool loop the user drives interactively. Routing economics (B-vs-A) are fully representative; compression (A-vs-C) is measured at the SMALLEST context (single shot), so a compression win here is a **conservative floor** that grows in a real accumulating-context session, and a compression loss (e.g. scaffolding overhead on tiny tasks) would shrink or flip. A full agentic soak is the separate follow-up.");
  L.push("- Opus priced at API rates for the counterfactual; actual usage was on a Max-plan flat fee. The ~49k system-prompt tax per fresh CLI call dominates Opus cost and is part of why go-pilot routes cheap subtasks off Opus.");
  L.push("- Workhorse $ is a calibrated estimate reconciled to the gateway's settled cumulative spend; per-model split preserves the calibrated ratio.");
  L.push("- Reasoning-model output is non-deterministic even at temperature 0; trials capture the spread. Empties/refusals/timeouts are counted as failures, not folded into quality.\n");
  return L.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
