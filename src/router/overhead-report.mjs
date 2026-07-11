// Router overhead report.
//
// Reads the judgment-cost JSONL log (written by judgment-log.mjs) and reports
// the LLM-judgment token cost as its OWN summable line item. This is a COST we
// pay to route — it is NEVER folded into, or netted against, any "savings"
// figure. Judgment overhead and routing savings are separate ledgers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_LOG_PATH = resolve(REPO_ROOT, "metrics", "runs", "router-judgment.jsonl");

/**
 * Per-record honest overhead figure (Step 8.4). Precedence:
 *   actualTokens (measured) → estimatedTokens → precomputed `tokens` field → 0.
 * Actuals are summed when present so the report reflects real usage rather than
 * a blanket estimate. `tokens` is the field logJudgment writes with the same
 * precedence already applied (and a labeled fallback when nothing is known).
 */
function effectiveTokens(rec) {
  if (typeof rec.actualTokens === "number") return rec.actualTokens;
  if (typeof rec.estimatedTokens === "number") return rec.estimatedTokens;
  if (typeof rec.tokens === "number") return rec.tokens;
  return 0;
}

/**
 * Summarize router judgment overhead from the JSONL log.
 *
 * Prefers MEASURED actual tokens over the estimate on a per-record basis; the
 * headline `totalEstimatedTokens` (kept for backward compatibility) is that
 * actual-preferred effective total, and equals the pure estimate sum when no
 * record carries an actual. `totalActualTokens` / `actualCount` expose how much
 * of the total is measured vs estimated.
 *
 * @param {{logPath?: string}} [opts] - logPath overrides the default path.
 * @returns {{calls: number, totalEstimatedTokens: number, totalActualTokens: number, totalTokens: number, actualCount: number, byCategory: Object<string, {calls: number, estimatedTokens: number}>}}
 *   A missing log file yields all-zeros (never throws).
 */
export function summarizeOverhead(opts = {}) {
  const logPath = opts.logPath || DEFAULT_LOG_PATH;

  const empty = {
    calls: 0,
    totalEstimatedTokens: 0,
    totalActualTokens: 0,
    totalTokens: 0,
    actualCount: 0,
    byCategory: {},
  };

  let raw;
  try {
    raw = readFileSync(logPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return empty;
    }
    throw err;
  }

  let calls = 0;
  let totalTokens = 0;
  let totalActualTokens = 0;
  let actualCount = 0;
  const byCategory = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue; // ignore blank lines

    const rec = JSON.parse(trimmed);
    const tokens = effectiveTokens(rec);
    const category = rec.category ?? "uncategorized";

    calls += 1;
    totalTokens += tokens;
    if (typeof rec.actualTokens === "number") {
      actualCount += 1;
      totalActualTokens += rec.actualTokens;
    }

    if (!byCategory[category]) {
      byCategory[category] = { calls: 0, estimatedTokens: 0 };
    }
    byCategory[category].calls += 1;
    byCategory[category].estimatedTokens += tokens;
  }

  return {
    calls,
    // Legacy name, kept for backward compatibility — now the actual-preferred
    // effective total (== pure estimate sum when no actuals are present).
    totalEstimatedTokens: totalTokens,
    totalActualTokens,
    totalTokens,
    actualCount,
    byCategory,
  };
}

/**
 * Render a short markdown report. Explicitly headed as ROUTER OVERHEAD — a
 * distinct cost, NOT a savings figure.
 *
 * @param {{calls: number, totalEstimatedTokens: number, byCategory: Object<string, {calls: number, estimatedTokens: number}>}} summary
 * @returns {string}
 */
export function formatReport(summary) {
  const {
    calls,
    totalEstimatedTokens,
    totalActualTokens = 0,
    actualCount = 0,
  } = summary;
  const byCategory = summary.byCategory;

  const lines = [];
  lines.push("## Router Overhead (judgment cost — NOT savings)");
  lines.push("");
  lines.push("Router LLM-judgment token cost, reported as its own summable line item.");
  lines.push("");
  lines.push(`- Total judgment calls: ${calls}`);
  lines.push(`- Total overhead tokens (actual-preferred): ${totalEstimatedTokens}`);
  lines.push(
    `- Of which measured (actual): ${totalActualTokens} tokens across ${actualCount}/${calls} calls; the remainder is estimated.`,
  );
  lines.push("");
  lines.push("| Category | Calls | Estimated tokens |");
  lines.push("| --- | --- | --- |");

  const categories = Object.keys(byCategory).sort();
  for (const category of categories) {
    const c = byCategory[category];
    lines.push(`| ${category} | ${c.calls} | ${c.estimatedTokens} |`);
  }

  return lines.join("\n");
}
