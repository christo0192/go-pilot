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
 * Summarize router judgment overhead from the JSONL log.
 *
 * @param {{logPath?: string}} [opts] - logPath overrides the default path.
 * @returns {{calls: number, totalEstimatedTokens: number, byCategory: Object<string, {calls: number, estimatedTokens: number}>}}
 *   calls = number of judgment records; totalEstimatedTokens = summed cost;
 *   byCategory maps category -> { calls, estimatedTokens }.
 *   A missing log file yields all-zeros (never throws).
 */
export function summarizeOverhead(opts = {}) {
  const logPath = opts.logPath || DEFAULT_LOG_PATH;

  let raw;
  try {
    raw = readFileSync(logPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return { calls: 0, totalEstimatedTokens: 0, byCategory: {} };
    }
    throw err;
  }

  let calls = 0;
  let totalEstimatedTokens = 0;
  const byCategory = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue; // ignore blank lines

    const rec = JSON.parse(trimmed);
    const tokens = typeof rec.estimatedTokens === "number" ? rec.estimatedTokens : 0;
    const category = rec.category ?? "uncategorized";

    calls += 1;
    totalEstimatedTokens += tokens;

    if (!byCategory[category]) {
      byCategory[category] = { calls: 0, estimatedTokens: 0 };
    }
    byCategory[category].calls += 1;
    byCategory[category].estimatedTokens += tokens;
  }

  return { calls, totalEstimatedTokens, byCategory };
}

/**
 * Render a short markdown report. Explicitly headed as ROUTER OVERHEAD — a
 * distinct cost, NOT a savings figure.
 *
 * @param {{calls: number, totalEstimatedTokens: number, byCategory: Object<string, {calls: number, estimatedTokens: number}>}} summary
 * @returns {string}
 */
export function formatReport(summary) {
  const { calls, totalEstimatedTokens, byCategory } = summary;

  const lines = [];
  lines.push("## Router Overhead (judgment cost — NOT savings)");
  lines.push("");
  lines.push("Router LLM-judgment token cost, reported as its own summable line item.");
  lines.push("");
  lines.push(`- Total judgment calls: ${calls}`);
  lines.push(`- Total estimated overhead tokens: ${totalEstimatedTokens}`);
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
