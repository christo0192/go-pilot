// v1-vs-v2 comparison across model conditions (Codex §10 metrics).
//
// For the 12 Kimi-area fixtures (doc-QA / analysis / extraction), Arm A, compares:
//   Kimi-v1, Kimi-v2(repair), DeepSeek-v1, DeepSeek-v2(repair), and Opus (Arm B).
// Reports, per condition:
//   success_rate, quality_when_completed, reliability_adjusted_quality
//   (= quality_when_completed x success_rate), Opus-only-judge quality,
//   and cost_per_success — the honest, failure-and-self-preference-corrected view.
//
// Zero external deps.

import { readFileSync, existsSync } from "node:fs";
import { estimateCallCost } from "../../src/metrics/cost-model.mjs";

const CAL = JSON.parse(readFileSync(new URL("./calibration.json", import.meta.url), "utf8")).rates;
const FIXTURES = ["docqa-01","docqa-02","docqa-03","docqa-04","analysis-01","analysis-02","analysis-03","analysis-04","extract-01","extract-02","extract-03","extract-04"];
const FAILURE_TAGS = new Set(["error", "empty", "timeout", "truncated", "budget-skip", "grade-error"]);

const readJsonl = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

function runCost(rec) {
  if (rec.provider === "anthropic-cli") return Number.isFinite(rec.costUsd) ? rec.costUsd : 0;
  if (rec.gatewayModel) return estimateCallCost(rec.gatewayModel, rec.tokens || {}, CAL);
  return Number.isFinite(rec.costUsd) ? rec.costUsd : 0;
}

// Build a condition's per-fixture view from its run + graded ledgers.
function condition(label, dir, arm) {
  const runs = new Map(readJsonl(`${dir}/campaign-runs.jsonl`).filter((r) => r.arm === arm && FIXTURES.includes(r.fixtureId)).map((r) => [r.fixtureId, r]));
  const graded = new Map(readJsonl(`${dir}/graded-runs.jsonl`).filter((g) => g.arm === arm && FIXTURES.includes(g.fixtureId)).map((g) => [g.fixtureId, g]));
  const rows = [];
  for (const id of FIXTURES) {
    const r = runs.get(id), g = graded.get(id);
    if (!r) { rows.push({ id, present: false }); continue; }
    const failed = (r.failures || []).some((f) => FAILURE_TAGS.has(f)) || (g && (g.failures || []).some((f) => FAILURE_TAGS.has(f)));
    rows.push({
      id, present: true, failed: !!failed,
      score: g ? g.finalScore : r.score,
      // Only count the Opus judge when its output actually parsed — an unparsed
      // reading is recorded as overall 0 and must NOT be averaged as a real score.
      opusScore: g?.judges?.opus?.ok ? g.judges.opus.overall : null,
      cost: runCost(r), repaired: !!r.repairUsed, tokens: r.tokens?.total ?? null,
    });
  }
  const present = rows.filter((x) => x.present);
  const ok = present.filter((x) => !x.failed && x.score != null);
  const successRate = present.length ? ok.length / present.length : NaN;
  const qWhenDone = mean(ok.map((x) => x.score));
  const opusOnly = mean(ok.map((x) => x.opusScore).filter((v) => v != null));
  const totalCost = present.reduce((s, x) => s + (x.cost || 0), 0);
  return {
    label, arm, rows, n: present.length, ok: ok.length,
    successRate, qWhenDone,
    reliabilityAdjusted: qWhenDone * successRate,
    opusOnly, totalCost, costPerSuccess: ok.length ? totalCost / ok.length : NaN,
    repairs: present.filter((x) => x.repaired).length,
  };
}

const B = "scripts/baseline-rig";
const conds = [
  condition("Kimi v1", `${B}/out`, "A"),
  condition("Kimi v2 (repair)", `${B}/out-kimi-v2`, "A"),
  condition("DeepSeek v1", `${B}/out-deepseek`, "A"),
  condition("DeepSeek v2 (repair)", `${B}/out-deepseek-v2`, "A"),
  condition("Opus (Arm B)", `${B}/out`, "B"),
];

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : " -- ");
console.log("Arm A on the 12 Kimi-area fixtures (doc-QA / analysis / extraction)\n");
console.log("condition             | n  | success | q|done | reliab-adj | Opus-judge | $/success | repairs");
console.log("----------------------|----|---------|-------|------------|------------|-----------|--------");
for (const c of conds) {
  console.log(
    c.label.padEnd(21) + " | " + String(c.n).padStart(2) + " | " +
    (f(c.successRate * 100, 0) + "%").padStart(7) + " | " + f(c.qWhenDone).padStart(5) + " | " +
    f(c.reliabilityAdjusted).padStart(10) + " | " + f(c.opusOnly).padStart(10) + " | " +
    ("$" + f(c.costPerSuccess, 4)).padStart(9) + " | " + String(c.repairs).padStart(6),
  );
}

console.log("\nPer-fixture quality (final dual-judge score):");
console.log("fixture     | " + conds.map((c) => c.label.slice(0, 10).padStart(10)).join(" | "));
for (const id of FIXTURES) {
  const cells = conds.map((c) => {
    const row = c.rows.find((x) => x.id === id);
    return (row?.present ? (row.failed ? "FAIL" : String(Math.round(row.score))) : "--").padStart(10);
  });
  console.log(id.padEnd(11) + " | " + cells.join(" | "));
}
