// K2.5 screening analysis — K2.5 vs DeepSeek vs K2.6 vs Opus on the 21 fixtures.
//   K25   = out-v3-k25       arm A (K2.5 routed) + C (K2.5 naive), 1 trial
//   DEEP  = out-v3-deepseek  arm A (DeepSeek-only, 3 trials)
//   K26   = out-v3-trim      arm A (K2.6-only, 1 trial)
//   OPUS  = out-v3-k25       arm B (frozen Opus reference)
// Scores the user's K3-plan screening gates. Zero deps.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (x == null ? "n/a" : Math.round(x * 10) / 10);
const NARRATIVE = new Set(["analysis", "creative-writing", "document-qa"]);

function loadArm(dir, arm) {
  const graded = readJsonl(join(HERE, dir, "graded-runs.jsonl")).filter((r) => r.arm === arm);
  const runs = Object.fromEntries(readJsonl(join(HERE, dir, "campaign-runs.jsonl")).filter((r) => r.arm === arm).map((r) => [r.key, r]));
  const byFix = {};
  for (const g of graded) {
    const run = runs[g.key] || {};
    (byFix[g.fixtureId] ||= { area: g.areaName, scores: [], tokens: [], cost: [], fails: 0 }).scores.push(g.finalScore);
    byFix[g.fixtureId].tokens.push(run.tokens?.total ?? 0);
    byFix[g.fixtureId].cost.push(run.estCostUsd ?? run.costUsd ?? 0);
    if ((run.failures || []).length) byFix[g.fixtureId].fails += 1;
  }
  return byFix;
}

const K25 = loadArm("out-v3-k25", "A"), K25C = loadArm("out-v3-k25", "C");
const DEEP = loadArm("out-v3-deepseek", "A"), K26 = loadArm("out-v3-trim", "A"), OPUS = loadArm("out-v3-k25", "B");
const FIX = Object.keys(K25);
const areaOf = (f) => (K25[f] || {}).area;
const AREAS = [...new Set(FIX.map(areaOf))].sort();
const q = (v, f) => (v[f] ? median(v[f].scores) : null);
const tok = (v, f) => (v[f] ? median(v[f].tokens) : null);
const cost = (v, f) => (v[f] ? median(v[f].cost) : null);

// Reliability: count empty/truncated across arm-A runs (screening = 1 trial).
let k25Fails = 0; for (const f of FIX) k25Fails += K25[f]?.fails || 0;
const k25Q = mean(FIX.map((f) => q(K25, f)).filter((x) => x != null));
const deepQ = mean(FIX.map((f) => q(DEEP, f)).filter((x) => x != null));
const k26Q = mean(FIX.map((f) => q(K26, f)).filter((x) => x != null));
const k25Cost = FIX.reduce((s, f) => s + (cost(K25, f) || 0), 0);
const k25Tok = FIX.reduce((s, f) => s + (tok(K25, f) || 0), 0);
const deepTok = FIX.reduce((s, f) => s + (tok(DEEP, f) || 0), 0);
const k26Tok = FIX.reduce((s, f) => s + (tok(K26, f) || 0), 0);
const k25CostPerSuccess = k25Cost / FIX.filter((f) => q(K25, f) != null).length;

let md = "# K2.5 screening — 1 trial, arms A(routed)+C(naive) vs DeepSeek / K2.6 / Opus\n\n";
md += "## Per-area quality (Opus judge)\n\n| Area | K2.5 (A) | DeepSeek (A) | K2.6 (A) | Opus (B) | K2.5−DeepSeek |\n|---|--:|--:|--:|--:|--:|\n";
for (const a of AREAS) {
  const fa = FIX.filter((f) => areaOf(f) === a);
  const k = mean(fa.map((f) => q(K25, f)).filter((x) => x != null));
  const d = mean(fa.map((f) => q(DEEP, f)).filter((x) => x != null));
  const k6 = mean(fa.map((f) => q(K26, f)).filter((x) => x != null));
  const o = mean(fa.map((f) => q(OPUS, f)).filter((x) => x != null));
  const dd = k != null && d != null ? k - d : null;
  md += `| ${a} | ${r1(k)} | ${r1(d)} | ${r1(k6)} | ${r1(o)} | ${dd == null ? "n/a" : (dd >= 0 ? "+" : "") + r1(dd)} |\n`;
}
md += `\n## Headline (all 21 fixtures)\n\n`;
md += `| Metric | K2.5 | DeepSeek | K2.6 |\n|---|--:|--:|--:|\n`;
md += `| Mean quality | ${r1(k25Q)} | ${r1(deepQ)} | ${r1(k26Q)} |\n`;
md += `| Total tokens (Σ medians) | ${k25Tok} | ${deepTok} | ${k26Tok} |\n`;
md += `| Arm-A failures | ${k25Fails} | 0 | (see trim) |\n`;
md += `| Cost/success | $${r1(k25CostPerSuccess * 10000) / 10000} | $0.0020 | $0.0308 (lean-Opus) |\n`;

// Narrative-only (where a Kimi variant should help most).
const narr = FIX.filter((f) => NARRATIVE.has(areaOf(f)));
const k25Narr = mean(narr.map((f) => q(K25, f)).filter((x) => x != null));
const deepNarr = mean(narr.map((f) => q(DEEP, f)).filter((x) => x != null));

// Screening gates (from the user's K3 test plan).
const gates = [
  ["Completed quality ≥ 93", k25Q, k25Q != null && k25Q >= 93],
  ["Reliability-adjusted quality ≥ 92 (100% success by fallback? no — screening)", k25Q, k25Q != null && k25Q >= 92],
  ["Zero unresolved failures (arm A)", k25Fails, k25Fails === 0],
  ["Clear improvement over DeepSeek on narrative", `${r1(k25Narr)} vs ${r1(deepNarr)}`, k25Narr != null && deepNarr != null && k25Narr - deepNarr >= 2],
  ["Cost/success below lean Opus ($0.0438)", k25CostPerSuccess, k25CostPerSuccess < 0.0438],
];
md += "\n## Screening gates (expand to 3 trials only if all pass)\n\n| Gate | Value | Verdict |\n|---|--:|:-:|\n";
for (const [n, v, p] of gates) md += `| ${n} | ${typeof v === "number" ? r1(v) : v} | ${p ? "✅" : "❌"} |\n`;
md += `\n**${gates.filter((g) => g[2]).length}/${gates.length} gates pass.** K2.5 mean ${r1(k25Q)} vs DeepSeek ${r1(deepQ)} vs K2.6 ${r1(k26Q)}.\n`;

console.log(md);
