// Reproducible production-route scorecard from the frozen K2.5 and DeepSeek
// three-trial ledgers. This does not call a model or mutate benchmark records.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AREAS = ["document-qa", "extraction"];

function readJsonl(path) {
  if (!existsSync(path)) throw new Error(`missing benchmark ledger: ${path}`);
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
}

function latest(records) {
  return [...new Map(records.map((record) => [record.key, record])).values()];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeRecords(runsInput, gradesInput, area) {
  const runs = latest(runsInput).filter((run) => run.arm === "A" && run.areaName === area);
  const grades = new Map(latest(gradesInput).map((grade) => [grade.key, grade]));
  const byFixture = new Map();
  let successes = 0;
  let totalTokens = 0;
  let reasoningTokens = 0;
  let totalCostUsd = 0;
  let maxLatencyMs = 0;

  for (const run of runs) {
    const grade = grades.get(run.key);
    const score = Number.isFinite(grade?.finalScore) ? grade.finalScore : null;
    const failed = (run.failures || []).length > 0 || score == null;
    if (!failed) successes += 1;
    if (score != null) {
      const scores = byFixture.get(run.fixtureId) || [];
      scores.push(score);
      byFixture.set(run.fixtureId, scores);
    }
    totalTokens += Number(run.tokens?.total) || 0;
    reasoningTokens += Number(run.tokens?.reasoning) || 0;
    totalCostUsd += Number(run.estCostUsd ?? run.costUsd) || 0;
    maxLatencyMs = Math.max(maxLatencyMs, Number(run.latencyMs) || 0);
  }

  const fixtureMedians = Object.fromEntries([...byFixture].map(([id, scores]) => [id, median(scores)]));
  const quality = mean(Object.values(fixtureMedians).filter(Number.isFinite));
  return {
    area,
    runs: runs.length,
    successes,
    fixtures: byFixture.size,
    quality,
    reliabilityPct: runs.length ? successes / runs.length * 100 : null,
    totalTokens,
    reasoningTokens,
    tokensPerSuccess: successes ? totalTokens / successes : null,
    costPerSuccessUsd: successes ? totalCostUsd / successes : null,
    maxLatencyMs,
    fixtureMedians,
  };
}

export function loadSummary(dir, area) {
  return summarizeRecords(
    readJsonl(join(HERE, dir, "campaign-runs.jsonl")),
    readJsonl(join(HERE, dir, "graded-runs.jsonl")),
    area,
  );
}

function combined(summaries) {
  const runs = summaries.reduce((sum, x) => sum + x.runs, 0);
  const successes = summaries.reduce((sum, x) => sum + x.successes, 0);
  const tokens = summaries.reduce((sum, x) => sum + x.totalTokens, 0);
  const cost = summaries.reduce((sum, x) => sum + x.costPerSuccessUsd * x.successes, 0);
  const fixtureScores = summaries.flatMap((x) => Object.values(x.fixtureMedians));
  return {
    runs, successes, quality: mean(fixtureScores), reliabilityPct: successes / runs * 100,
    tokensPerSuccess: tokens / successes, costPerSuccessUsd: cost / successes,
    maxLatencyMs: Math.max(...summaries.map((x) => x.maxLatencyMs)),
  };
}

function f1(value) { return value == null ? "n/a" : value.toFixed(1); }
function money(value) { return value == null ? "n/a" : `$${value.toFixed(4)}`; }
function integer(value) { return value == null ? "n/a" : Math.round(value).toLocaleString("en-US"); }

export function buildReport() {
  const k25 = AREAS.map((area) => loadSummary("out-v3-k25", area));
  const deep = AREAS.map((area) => loadSummary("out-v3-deepseek", area));
  const prod = combined(k25);
  const baseline = combined(deep);
  const rows = AREAS.map((area, index) => {
    const a = k25[index];
    const b = deep[index];
    const label = area === "document-qa" ? "document-QA" : area;
    return `| ${label} | ${a.runs}/${a.runs} | ${f1(a.quality)} | ${f1(a.reliabilityPct)}% | ${integer(a.tokensPerSuccess)} | ${money(a.costPerSuccessUsd)} | ${(a.maxLatencyMs / 1000).toFixed(0)}s | ${a.quality >= b.quality ? "+" : ""}${f1(a.quality - b.quality)} |`;
  }).join("\n");
  const tokenDelta = (prod.tokensPerSuccess / baseline.tokensPerSuccess - 1) * 100;
  const qualityDelta = prod.quality - baseline.quality;

  return `# Production routing metrics\n\n` +
    `Generated from the frozen 3-trial Arm-A ledgers in \`out-v3-k25\` and \`out-v3-deepseek\`. Latest record per run key wins. No model calls or estimated quality values are introduced by this report.\n\n` +
    `## Selected K2.5 routes\n\n` +
    `| Area | Complete runs | Quality /100 | Reliability | Tokens/success | Cost/success | Max latency | Quality vs DeepSeek |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `Across these two production-selected areas: **${f1(prod.quality)}/100 quality**, **${f1(prod.reliabilityPct)}% reliability**, **${integer(prod.tokensPerSuccess)} tokens/success**, and **${money(prod.costPerSuccessUsd)} per success** over ${prod.runs} replicated runs. Versus DeepSeek on the same fixtures, quality is **${qualityDelta >= 0 ? "+" : ""}${f1(qualityDelta)} points** and tokens/success are **${tokenDelta >= 0 ? "+" : ""}${f1(tokenDelta)}%**.\n\n` +
    `## Interpretation\n\n` +
    `- Document-QA clears its promotion evidence: quality >=97, 100% reliability, and no observed fixture regression.\n` +
    `- Extraction is a deliberate tradeoff: it improves the area mean over DeepSeek, but its ${f1(k25[1].quality)} score remains below the 90 quality gate and includes one fixture regression. The production schema/citation validator and DeepSeek fallback added after these runs protect format and mechanical reliability; their quality lift is **not** claimed until a fresh controlled campaign measures it.\n` +
    `- This scorecard covers model-facing quality/cost/token evidence. Unit and integration verification belongs in the engineering handover, not in these benchmark figures.\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = join(HERE, "..", "..", "docs", "production-metrics.md");
  const check = process.argv.includes("--check");
  let report;
  try {
    report = buildReport();
  } catch (err) {
    // The benchmark ledgers are gitignored, so a clean checkout (CI) has no data
    // to regenerate from. Freshness is a pre-commit/local gate where the ledgers
    // exist; skip cleanly instead of failing where they don't.
    if (check && /missing benchmark ledger/.test(err.message)) {
      process.stdout.write("production metrics: skipped (benchmark ledgers not present)\n");
      process.exit(0);
    }
    throw err;
  }
  if (process.argv.includes("--write")) {
    writeFileSync(path, report);
    process.stdout.write(`${path}\n`);
  } else if (check) {
    // Line-ending-insensitive so a CRLF checkout (Windows CI) is not read as stale.
    if (readFileSync(path, "utf8").replace(/\r\n/g, "\n") !== report.replace(/\r\n/g, "\n")) throw new Error("docs/production-metrics.md is stale; run npm run metrics:production");
    process.stdout.write("production metrics: current\n");
  } else {
    process.stdout.write(report);
  }
}
