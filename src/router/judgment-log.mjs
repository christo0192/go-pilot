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
 * Append one judgment record as a JSON line.
 *
 * @param {{taskId?: string, category?: string, estimatedTokens?: number}} record
 * @param {{logPath?: string}} [opts] - logPath overrides the default path.
 * @returns {{ts: string, taskId: (string|null), category: (string|null), estimatedTokens: (number|null)}}
 *          the exact record written (including the generated timestamp).
 *
 * ts = new Date().toISOString() is fine HERE: this is runtime logging, not
 * the pure decision path.
 */
export function logJudgment(record = {}, opts = {}) {
  const logPath = opts.logPath || DEFAULT_LOG_PATH;

  const entry = {
    ts: new Date().toISOString(),
    taskId: record.taskId ?? null,
    category: record.category ?? null,
    estimatedTokens: record.estimatedTokens ?? null,
  };

  // Ensure the target directory exists (create metrics/runs/ if missing).
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");

  return entry;
}
