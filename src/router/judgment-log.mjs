// Judgment-cost logger.
//
// Appends ONE self-contained JSON line per judgment escalation. This is the
// only part of the router subsystem that touches disk. Each record stands
// alone and is trivially summable; records are NEVER merged into a "savings"
// figure — judgment is a cost we track honestly, not net against anything.

import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_LOG_PATH = resolve(REPO_ROOT, "metrics", "runs", "router-judgment.jsonl");

/**
 * Labeled fallback used when neither an actual nor an estimated judgment-token
 * count is known. Mirrors router.mjs's JUDGMENT_ESTIMATED_TOKENS — it is an
 * ESTIMATE, clearly marked as such via `tokenSource: "fallback-estimate"`, and
 * is never treated as a measured value.
 */
export const FALLBACK_ESTIMATED_TOKENS = 1500;

/**
 * Append one judgment record as a JSON line.
 *
 * Token accounting (Step 8.4): a record may now carry the ACTUAL tokens the
 * judgment call consumed. Precedence for the honest overhead figure is
 * actualTokens → estimatedTokens → FALLBACK_ESTIMATED_TOKENS, and the written
 * entry records which one was used via `tokenSource` so a downstream report can
 * tell measured cost from a guess. `estimatedTokens` is still written verbatim
 * for backward compatibility with existing readers.
 *
 * @param {{taskId?: string, category?: string, estimatedTokens?: number, actualTokens?: number}} record
 * @param {{logPath?: string}} [opts] - logPath overrides the default path.
 * @returns {{ts: string, taskId: (string|null), category: (string|null), estimatedTokens: (number|null), actualTokens: (number|null), tokens: number, tokenSource: string}}
 *          the exact record written (including the generated timestamp).
 *
 * ts = new Date().toISOString() is fine HERE: this is runtime logging, not
 * the pure decision path.
 */
export function logJudgment(record = {}, opts = {}) {
  const logPath = opts.logPath || DEFAULT_LOG_PATH;

  const hasActual = typeof record.actualTokens === "number";
  const hasEstimate = typeof record.estimatedTokens === "number";

  let tokens;
  let tokenSource;
  if (hasActual) {
    tokens = record.actualTokens;
    tokenSource = "actual";
  } else if (hasEstimate) {
    tokens = record.estimatedTokens;
    tokenSource = "estimate";
  } else {
    tokens = FALLBACK_ESTIMATED_TOKENS;
    tokenSource = "fallback-estimate";
  }

  const entry = {
    ts: new Date().toISOString(),
    taskId: record.taskId ?? null,
    category: record.category ?? null,
    estimatedTokens: record.estimatedTokens ?? null,
    actualTokens: record.actualTokens ?? null,
    // `tokens` = the honest overhead figure per the precedence above.
    tokens,
    tokenSource,
  };

  // Ensure the target directory exists (create metrics/runs/ if missing).
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");

  return entry;
}
