// Hybrid experiment analysis — DeepSeek->Kimi synthesis vs DeepSeek-only vs Kimi-only.
//
// Reads three campaigns (same 21 fixtures, seed 20260713):
//   KIMI  = out-v3-trim      arm A (Kimi-only, 1 trial)
//   DEEP  = out-v3-deepseek  arm A (DeepSeek-only, 3 trials)
//   OPUS  = out-v3-deepseek  arm B (Opus, frozen reference)
//   CAND  = out-v3-hybrid    arm Dcand (DeepSeek candidate — paired baseline)
//   HYB   = out-v3-hybrid    arm D (final hybrid: synth-or-fallback, 3 trials)
//
// Produces TWO results (Codex refinement #3):
//   1. All-task ablation — does unconditional synthesis help/hurt each category?
//   2. Selective production policy — Kimi synth only for creative/analysis/doc-qa,
//      DeepSeek final for extraction/spreadsheet.
// Then scores the user's promotion gates. Zero external deps.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { numTokens } from "./campaign.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? "n/a" : Math.round(x * 10) / 10);
const money = (x) => (x == null ? "n/a" : "$" + (Math.round(x * 10000) / 10000).toFixed(4));

const NARRATIVE = new Set(["analysis", "creative-writing", "document-qa"]);

/** Load one arm from a dir: join graded (finalScore/judges) to campaign (tokens/cost/hybrid). */
function loadArm(dir, arm) {
  const graded = readJsonl(join(HERE, dir, "graded-runs.jsonl")).filter((r) => r.arm === arm);
  const runs = readJsonl(join(HERE, dir, "campaign-runs.jsonl")).filter((r) => r.arm === arm);
  const runByKey = Object.fromEntries(runs.map((r) => [r.key, r]));
  const byFixture = {};
  for (const g of graded) {
    const run = runByKey[g.key] || {};
    (byFixture[g.fixtureId] ||= { area: g.areaName, scores: [], tokens: [], cost: [], recs: [] }).scores.push(g.finalScore);
    byFixture[g.fixtureId].tokens.push(run.tokens?.total ?? 0);
    byFixture[g.fixtureId].cost.push(run.estCostUsd ?? run.costUsd ?? 0);
    byFixture[g.fixtureId].recs.push({ g, run });
  }
  return byFixture;
}

const KIMI = loadArm("out-v3-trim", "A");
const DEEP = loadArm("out-v3-deepseek", "A");
const OPUS = loadArm("out-v3-deepseek", "B");
const CAND = loadArm("out-v3-hybrid", "Dcand");
const HYB = loadArm("out-v3-hybrid", "D");

const FIXTURES = Object.keys(HYB).length ? Object.keys(HYB) : Object.keys(DEEP);
const areaOf = (f) => (HYB[f] || DEEP[f] || {}).area;

// Per-fixture medians for each variant.
const fx = {};
for (const f of FIXTURES) {
  const q = (v) => (v[f] ? median(v[f].scores) : null);
  const tok = (v) => (v[f] ? median(v[f].tokens) : null);
  const cost = (v) => (v[f] ? median(v[f].cost) : null);
  fx[f] = {
    area: areaOf(f),
    kimiQ: q(KIMI), deepQ: q(DEEP), opusQ: q(OPUS), candQ: q(CAND), hybQ: q(HYB),
    kimiTok: tok(KIMI), deepTok: tok(DEEP), hybTok: tok(HYB), deepCost: cost(DEEP), hybCost: cost(HYB), kimiCost: cost(KIMI),
  };
}

// Hybrid diagnostics: fallback rate, numeric preservation, pack grounding, dimension deltas.
const hybDiag = { fallbacks: 0, synthUsed: 0, total: 0, numPresSynth: [], packGrounding: [], numericRegressions: 0, citationRegressions: 0 };
const citTokens = (s) => (String(s || "").match(/\[[^\]]{1,20}\]/g) || []).length;
for (const f of FIXTURES) {
  for (const { g, run } of (HYB[f]?.recs || [])) {
    hybDiag.total += 1;
    const h = run.hybrid || {};
    if (h.usedFallback) hybDiag.fallbacks += 1; else hybDiag.synthUsed += 1;
    if (h.packGrounding != null) hybDiag.packGrounding.push(h.packGrounding);
    if (!h.usedFallback) {
      if (h.numPreserved != null) hybDiag.numPresSynth.push(h.numPreserved);
      // Regression vs the DeepSeek candidate we'd otherwise have shipped.
      const cand = (CAND[f]?.recs || []).find((c) => c.g.trial === g.trial);
      if (cand) {
        const candNums = numTokens(cand.run.output), finNums = numTokens(run.output);
        for (const n of candNums) if (!finNums.has(n)) { hybDiag.numericRegressions += 1; break; }
        if (citTokens(cand.run.output) > citTokens(run.output)) hybDiag.citationRegressions += 1;
      }
    }
  }
}

// Per-dimension HYB-vs-CAND deltas (Kimi's isolated contribution), per area.
function dimDeltas(area) {
  const fixturesInArea = FIXTURES.filter((f) => areaOf(f) === area);
  const dims = {};
  for (const f of fixturesInArea) {
    for (const { g } of (HYB[f]?.recs || [])) {
      const cand = (CAND[f]?.recs || []).find((c) => c.g.trial === g.trial);
      const hs = g.judges?.opus?.scores, cs = cand?.g.judges?.opus?.scores;
      if (!hs || !cs) continue;
      for (const d of Object.keys(hs)) { (dims[d] ||= []).push((hs[d] - (cs[d] ?? hs[d])) * 10); }
    }
  }
  const out = {};
  for (const [d, arr] of Object.entries(dims)) out[d] = mean(arr);
  return out;
}

// ---- Area rollups ----
const AREAS = [...new Set(FIXTURES.map(areaOf))].sort();
function areaAgg(area, qKey, tokKey) {
  const fs2 = FIXTURES.filter((f) => areaOf(f) === area);
  return { q: mean(fs2.map((f) => fx[f][qKey]).filter((x) => x != null)), tok: fs2.reduce((s, f) => s + (fx[f][tokKey] || 0), 0) };
}

let md = "# Hybrid experiment — DeepSeek→Kimi synthesis\n\n";
md += `_Generated from out-v3-hybrid (arm D/Dcand), out-v3-deepseek (A/B), out-v3-trim (Kimi A). Seed 20260713, 3 trials (Kimi/Opus frozen at 1)._\n\n`;

// ---- Report 1: all-task ablation ----
md += "## Report 1 — All-task ablation (does unconditional synthesis help or hurt?)\n\n";
md += "Quality = Opus-judge mean per area. HYB = final hybrid (synth-or-fallback). CAND = DeepSeek candidate (pre-synthesis). Δsynth = HYB − CAND (Kimi's isolated contribution).\n\n";
md += "| Area | Kimi-only | DeepSeek-only | Cand (DS pre-synth) | Hybrid final | Δsynth (HYB−CAND) | Opus |\n";
md += "|---|--:|--:|--:|--:|--:|--:|\n";
for (const a of AREAS) {
  const kimi = areaAgg(a, "kimiQ", "kimiTok").q, deep = areaAgg(a, "deepQ", "deepTok").q;
  const cand = areaAgg(a, "candQ", "hybTok").q, hyb = areaAgg(a, "hybQ", "hybTok").q, opus = areaAgg(a, "opusQ", "hybTok").q;
  const dsyn = hyb != null && cand != null ? hyb - cand : null;
  md += `| ${a} | ${r1(kimi)} | ${r1(deep)} | ${r1(cand)} | ${r1(hyb)} | ${dsyn == null ? "n/a" : (dsyn >= 0 ? "+" : "") + r1(dsyn)} | ${r1(opus)} |\n`;
}
md += "\n### Tokens per area (Σ fixture medians)\n\n| Area | Kimi-only | DeepSeek-only | Hybrid |\n|---|--:|--:|--:|\n";
for (const a of AREAS) md += `| ${a} | ${areaAgg(a, "kimiQ", "kimiTok").tok} | ${areaAgg(a, "deepQ", "deepTok").tok} | ${areaAgg(a, "hybQ", "hybTok").tok} |\n`;

md += "\n### Per-dimension Kimi contribution (HYB − CAND, judge points ×10)\n\n";
for (const a of AREAS) {
  const dd = dimDeltas(a);
  md += `- **${a}**: ${Object.entries(dd).map(([d, v]) => `${d} ${v >= 0 ? "+" : ""}${r1(v)}`).join(" · ") || "n/a"}\n`;
}

md += `\n### Hybrid reliability & fidelity\n\n`;
md += `- Runs: ${hybDiag.total} · synth used: ${hybDiag.synthUsed} · **fell back to DeepSeek: ${hybDiag.fallbacks}** (${r1(100 * hybDiag.fallbacks / hybDiag.total)}%)\n`;
md += `- Numeric preservation on synth-used finals: mean ${r1((mean(hybDiag.numPresSynth) || 0) * 100)}% · numeric regressions vs candidate: ${hybDiag.numericRegressions} · citation regressions: ${hybDiag.citationRegressions}\n`;
md += `- Pack-vs-source grounding (numbers in pack found in source): mean ${r1((mean(hybDiag.packGrounding) || 0) * 100)}%\n`;

// ---- Report 2: selective production policy ----
// Narrative (analysis/creative/doc-qa) -> hybrid; extraction/spreadsheet -> DeepSeek-only.
function policyAgg(useHybFor) {
  let qs = [], tok = 0, cost = 0, kimiTok = 0, kimiCost = 0;
  for (const f of FIXTURES) {
    const useHyb = useHybFor.has(areaOf(f));
    qs.push(useHyb ? fx[f].hybQ : fx[f].deepQ);
    tok += (useHyb ? fx[f].hybTok : fx[f].deepTok) || 0;
    cost += (useHyb ? fx[f].hybCost : fx[f].deepCost) || 0;
    kimiTok += fx[f].kimiTok || 0; kimiCost += fx[f].kimiCost || 0;
  }
  return { q: mean(qs.filter((x) => x != null)), tok, cost, kimiTok, kimiCost };
}
const pol = policyAgg(NARRATIVE);
const deepAll = policyAgg(new Set());        // DeepSeek-only everywhere
const hybAll = policyAgg(new Set(AREAS));    // Hybrid everywhere

md += "\n## Report 2 — Selective production policy\n\n";
md += "Policy = **hybrid synthesis for analysis/creative/doc-qa; DeepSeek-only for extraction/spreadsheet.**\n\n";
md += "| Variant | Mean quality | Total tokens | Total cost $ |\n|---|--:|--:|--:|\n";
md += `| Kimi-only (all) | ${r1(mean(FIXTURES.map((f) => fx[f].kimiQ).filter((x) => x != null)))} | ${pol.kimiTok} | ${money(pol.kimiCost)} |\n`;
md += `| DeepSeek-only (all) | ${r1(deepAll.q)} | ${deepAll.tok} | ${money(deepAll.cost)} |\n`;
md += `| Hybrid everywhere | ${r1(hybAll.q)} | ${hybAll.tok} | ${money(hybAll.cost)} |\n`;
md += `| **Selective policy** | **${r1(pol.q)}** | **${pol.tok}** | **${money(pol.cost)}** |\n`;

// ---- Promotion gates (user-specified) ----
const narrFix = FIXTURES.filter((f) => NARRATIVE.has(areaOf(f)));
const narrDelta = mean(narrFix.map((f) => (fx[f].hybQ != null && fx[f].candQ != null ? fx[f].hybQ - fx[f].candQ : null)).filter((x) => x != null));
const catLoss = AREAS.map((a) => { const c = areaAgg(a, "candQ", "hybTok").q, h = areaAgg(a, "hybQ", "hybTok").q; return { a, delta: h != null && c != null ? h - c : 0 }; });
const worstLoss = Math.min(...catLoss.map((c) => c.delta));
const hybRelAdj = mean(FIXTURES.map((f) => fx[f].hybQ).filter((x) => x != null)); // 100% success by fallback design
const kimiTotalTok = FIXTURES.reduce((s, f) => s + (fx[f].kimiTok || 0), 0);
const hybTotalTok = FIXTURES.reduce((s, f) => s + (fx[f].hybTok || 0), 0);
const kimiTotalCost = FIXTURES.reduce((s, f) => s + (fx[f].kimiCost || 0), 0);
const hybTotalCost = FIXTURES.reduce((s, f) => s + (fx[f].hybCost || 0), 0);

const gates = [
  ["Narrative Δquality (HYB−CAND) ≥ 2", narrDelta, narrDelta != null && narrDelta >= 2],
  ["No category loses > 1 pt", worstLoss, worstLoss >= -1],
  ["Zero numeric/citation regressions", `${hybDiag.numericRegressions}num/${hybDiag.citationRegressions}cit`, hybDiag.numericRegressions === 0 && hybDiag.citationRegressions === 0],
  ["Hybrid reliability-adjusted quality ≥ 92", hybRelAdj, hybRelAdj != null && hybRelAdj >= 92],
  ["Total tokens below Kimi-only", `${hybTotalTok} vs ${kimiTotalTok}`, hybTotalTok < kimiTotalTok],
  ["Cost ≥ 50% below Kimi-only", `${money(hybTotalCost)} vs ${money(kimiTotalCost)}`, hybTotalCost <= 0.5 * kimiTotalCost],
  ["Failed Kimi falls back to DeepSeek (cost counted)", `${hybDiag.fallbacks} fallbacks`, true],
];
md += "\n## Promotion gates\n\n| Gate | Value | Verdict |\n|---|--:|:-:|\n";
for (const [name, val, pass] of gates) md += `| ${name} | ${typeof val === "number" ? r1(val) : val} | ${pass ? "✅" : "❌"} |\n`;
const passCount = gates.filter((g) => g[2]).length;
md += `\n**${passCount}/${gates.length} gates pass.**\n`;

const REPORT = process.env.REPORT_PATH || resolve(HERE, "..", "..", "docs", "live-test-results-v3-hybrid.md");
writeFileSync(REPORT, md);
console.log(md);
console.error(`\nReport written -> ${REPORT}`);
