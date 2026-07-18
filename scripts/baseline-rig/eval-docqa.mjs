// Doc-QA promotion gate — K2.5 vs DeepSeek on the 6 doc-QA fixtures, 3 trials.
// Gates (user-specified): trial-median quality >=97, reliability 100%, every
// fixture >= DeepSeek (<=1 minor regression), cost/success < $0.02, max latency
// within SLA. Zero deps.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? "n/a" : Math.round(x * 10) / 10);
const DOCQA = ["docqa-01", "docqa-02", "docqa-03", "docqa-04", "docqa-hard-05", "docqa-medium-05"];
const SLA_MS = Number(process.env.SLA_MS || 240000); // report against 240s unless overridden

function armA(dir) {
  const graded = readJsonl(join(HERE, dir, "graded-runs.jsonl")).filter((r) => r.arm === "A" && DOCQA.includes(r.fixtureId));
  const runs = Object.fromEntries(readJsonl(join(HERE, dir, "campaign-runs.jsonl")).filter((r) => r.arm === "A" && DOCQA.includes(r.fixtureId)).map((r) => [r.key, r]));
  const byFix = {};
  for (const g of graded) {
    const run = runs[g.key] || {};
    (byFix[g.fixtureId] ||= { scores: [], cost: [], lat: [], fails: 0, n: 0 });
    byFix[g.fixtureId].scores.push(g.finalScore);
    byFix[g.fixtureId].cost.push(run.estCostUsd ?? run.costUsd ?? 0);
    if (run.latencyMs != null) byFix[g.fixtureId].lat.push(run.latencyMs);
    byFix[g.fixtureId].n += 1;
    if ((run.failures || []).length) byFix[g.fixtureId].fails += 1;
  }
  return byFix;
}

const K25 = armA("out-v3-k25");
const DEEP = armA("out-v3-deepseek");

let md = "# Doc-QA confirmation — K2.5 (3 trials) vs DeepSeek\n\n";
md += "| Fixture | K2.5 trials | K2.5 median | DeepSeek median | Δ | K2.5 max latency |\n|---|--|--:|--:|--:|--:|\n";
let allScores = [], totFails = 0, totRuns = 0, totCost = 0, totGraded = 0, maxLat = 0, regressions = 0, minorReg = 0;
for (const f of DOCQA) {
  const k = K25[f]?.scores || [], d = DEEP[f]?.scores || [];
  const km = median(k), dm = median(d);
  const delta = km != null && dm != null ? km - dm : null;
  const fl = Math.max(...(K25[f]?.lat || [0]));
  if (fl > maxLat) maxLat = fl;
  totFails += K25[f]?.fails || 0; totRuns += K25[f]?.n || 0;
  totCost += (K25[f]?.cost || []).reduce((a, b) => a + b, 0); totGraded += k.length;
  allScores.push(km);
  if (delta != null && delta < 0) { regressions += 1; if (delta >= -3) minorReg += 1; }
  md += `| ${f} | ${k.join(",")} | ${r1(km)} | ${r1(dm)} | ${delta == null ? "n/a" : (delta >= 0 ? "+" : "") + r1(delta)} | ${(fl / 1000).toFixed(0)}s |\n`;
}
const areaMedian = mean(allScores);
const costPerSuccess = totGraded ? totCost / totGraded : null;
const reliability = totRuns ? 100 * (totRuns - totFails) / totRuns : null;
// "at most one minor regression": pass if no hard regression (>3pt) AND minor regressions <=1
const regressionOK = (regressions - minorReg) === 0 && minorReg <= 1;

const gates = [
  ["Trial-median doc-QA quality >= 97", r1(areaMedian), areaMedian != null && areaMedian >= 97],
  ["Reliability 100% (0 failures over " + totRuns + " runs)", `${r1(reliability)}%`, totFails === 0],
  ["Every fixture >= DeepSeek (<=1 minor regression)", `${regressions} reg (${minorReg} minor, ${regressions - minorReg} hard)`, regressionOK],
  ["Cost/success < $0.02", `$${r1((costPerSuccess || 0) * 10000) / 10000}`, costPerSuccess != null && costPerSuccess < 0.02],
  ["Max latency within SLA (" + (SLA_MS / 1000) + "s)", `${(maxLat / 1000).toFixed(0)}s`, maxLat <= SLA_MS],
];
md += "\n## Promotion gates\n\n| Gate | Value | Verdict |\n|---|--:|:-:|\n";
for (const [n, v, p] of gates) md += `| ${n} | ${v} | ${p ? "✅" : "❌"} |\n`;
const pass = gates.every((g) => g[2]);
md += `\n**${gates.filter((g) => g[2]).length}/${gates.length} gates pass — ${pass ? "PROMOTE doc-QA -> K2.5" : "DO NOT promote yet"}.**\n`;
console.log(md);
