// Per-area promotion gate — K2.5 (out-v3-k25) vs DeepSeek (out-v3-deepseek),
// arm A, 3 trials. Generalizes the doc-QA confirmation to any area.
//
// Usage:
//   AREA=document-qa   QUALITY_FLOOR=97 MIN_DELTA=0 node eval-area.mjs
//   AREA=extraction    QUALITY_FLOOR=90 MIN_DELTA=2 node eval-area.mjs
//
// Gates: trial-median area quality >= QUALITY_FLOOR, reliability 100%, every
// fixture >= DeepSeek (<=1 minor <=3pt regression, 0 hard), area-mean delta vs
// DeepSeek >= MIN_DELTA, cost/success < COST_CAP, max latency <= SLA_MS. Zero deps.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadFixtures } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r1 = (x) => (x == null ? "n/a" : Math.round(x * 10) / 10);

const AREA = process.env.AREA || "document-qa";
const QUALITY_FLOOR = Number(process.env.QUALITY_FLOOR ?? 97);
const MIN_DELTA = Number(process.env.MIN_DELTA ?? 0);
const COST_CAP = Number(process.env.COST_CAP ?? 0.02);
const SLA_MS = Number(process.env.SLA_MS ?? 240000);
const FIXTURES = loadFixtures().filter((f) => f.areaName === AREA).map((f) => f.id);
if (!FIXTURES.length) { console.error(`no fixtures for area "${AREA}"`); process.exit(1); }

function armA(dir) {
  const graded = new Map(readJsonl(join(HERE, dir, "graded-runs.jsonl")).filter((r) => r.arm === "A" && FIXTURES.includes(r.fixtureId)).map((r) => [r.key, r]));
  const runs = [...new Map(readJsonl(join(HERE, dir, "campaign-runs.jsonl")).filter((r) => r.arm === "A" && FIXTURES.includes(r.fixtureId)).map((r) => [r.key, r])).values()];
  const byFix = {};
  for (const run of runs) {
    const g = graded.get(run.key);
    (byFix[run.fixtureId] ||= { scores: [], cost: [], lat: [], fails: 0, gradeFails: 0, n: 0 });
    if (Number.isFinite(g?.finalScore)) byFix[run.fixtureId].scores.push(g.finalScore);
    else byFix[run.fixtureId].gradeFails += 1;
    byFix[run.fixtureId].cost.push(run.estCostUsd ?? run.costUsd ?? 0);
    if (run.latencyMs != null) byFix[run.fixtureId].lat.push(run.latencyMs);
    byFix[run.fixtureId].n += 1;
    if ((run.failures || []).length) byFix[run.fixtureId].fails += 1;
  }
  return byFix;
}

const K25 = armA("out-v3-k25");
const DEEP = armA("out-v3-deepseek");
const OPUS_B = (() => { // frozen Opus reference from out-v3-k25 arm B (ceiling context)
  const g = readJsonl(join(HERE, "out-v3-k25", "graded-runs.jsonl")).filter((r) => r.arm === "B" && FIXTURES.includes(r.fixtureId));
  const by = {}; for (const x of g) (by[x.fixtureId] ||= []).push(x.finalScore); return by;
})();

let md = `# ${AREA} confirmation — K2.5 (3 trials) vs DeepSeek V4 Pro\n\n`;
md += "| Fixture | K2.5 trials | K2.5 median | DeepSeek median | Δ | Opus | K2.5 max lat |\n|---|--|--:|--:|--:|--:|--:|\n";
let medians = [], deepMedians = [], totFails = 0, gradeFails = 0, totRuns = 0, totCost = 0, totGraded = 0, maxLat = 0, hardReg = 0, minorReg = 0;
for (const f of FIXTURES) {
  const k = K25[f]?.scores || [], d = DEEP[f]?.scores || [];
  const km = median(k), dm = median(d), om = median(OPUS_B[f] || []);
  const delta = km != null && dm != null ? km - dm : null;
  const fl = Math.max(...(K25[f]?.lat || [0]));
  if (fl > maxLat) maxLat = fl;
  totFails += K25[f]?.fails || 0; totRuns += K25[f]?.n || 0;
  gradeFails += K25[f]?.gradeFails || 0;
  totCost += (K25[f]?.cost || []).reduce((a, b) => a + b, 0); totGraded += k.length;
  if (km != null) medians.push(km);
  if (dm != null) deepMedians.push(dm);
  if (delta != null && delta < 0) { if (delta < -3) hardReg += 1; else minorReg += 1; }
  md += `| ${f} | ${k.map(r1).join(",")} | ${r1(km)} | ${r1(dm)} | ${delta == null ? "n/a" : (delta >= 0 ? "+" : "") + r1(delta)} | ${r1(om)} | ${(fl / 1000).toFixed(0)}s |\n`;
}
const areaMedian = mean(medians);
const areaDelta = areaMedian != null && mean(deepMedians) != null ? areaMedian - mean(deepMedians) : null;
const costPerSuccess = totGraded ? totCost / totGraded : null;
const expectedRuns = FIXTURES.length * 3;

const gates = [
  [`Complete expected trial set`, `${totRuns}/${expectedRuns} runs, ${gradeFails} ungraded`, totRuns === expectedRuns && gradeFails === 0],
  [`Trial-median quality >= ${QUALITY_FLOOR}`, r1(areaMedian), areaMedian != null && areaMedian >= QUALITY_FLOOR],
  [`Reliability 100% (0 fail / ${totRuns} runs)`, `${totFails + gradeFails === 0 ? "100" : r1(100 * (totRuns - totFails - gradeFails) / totRuns)}%`, totFails === 0 && gradeFails === 0],
  ["Every fixture >= DeepSeek (<=1 minor, 0 hard reg)", `${minorReg} minor, ${hardReg} hard`, hardReg === 0 && minorReg <= 1],
  [`Area-mean improvement over DeepSeek >= +${MIN_DELTA}`, `${areaDelta == null ? "n/a" : (areaDelta >= 0 ? "+" : "") + r1(areaDelta)}`, areaDelta != null && areaDelta >= MIN_DELTA],
  [`Cost/success < $${COST_CAP}`, `$${r1((costPerSuccess || 0) * 10000) / 10000}`, costPerSuccess != null && costPerSuccess < COST_CAP],
  [`Max latency within SLA (${SLA_MS / 1000}s)`, `${(maxLat / 1000).toFixed(0)}s`, maxLat <= SLA_MS],
];
md += "\n## Promotion gates\n\n| Gate | Value | Verdict |\n|---|--:|:-:|\n";
for (const [n, v, p] of gates) md += `| ${n} | ${v} | ${p ? "✅" : "❌"} |\n`;
const pass = gates.every((g) => g[2]);
md += `\n**${gates.filter((g) => g[2]).length}/${gates.length} gates pass — ${pass ? `PROMOTE ${AREA} -> K2.5` : `DO NOT promote ${AREA} yet`}.**\n`;
console.log(md);
