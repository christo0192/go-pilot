// Metrics pipeline — PLAN Step 7.1.
//
// Captures, per run, the four acceptance metrics that feed the #10
// numeric-acceptance gate:
//   1. token reduction vs single-agent baseline
//   2. quality score (rubric-based)
//   3. retry rates
//   4. router overhead
//
// IMPORTANT LEDGER RULE: router overhead is its OWN summable line item. It is
// NEVER subtracted from, or netted against, token savings anywhere. Savings and
// overhead are separate ledgers (mirrors src/router/overhead-report.mjs).

import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { summarizeOverhead } from "../router/overhead-report.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_LOG_PATH = resolve(REPO_ROOT, "metrics", "runs", "metrics.jsonl");

/**
 * The shared metrics-record contract (later tasks depend on this shape):
 *
 * {
 *   runId: string,                                 // required, non-empty
 *   taskClass?: string,                            // optional
 *   tokens:  { single: number, multi: number },    // required, positive numbers
 *   quality: { single: number, multi: number },    // required numbers
 *   retries: { count: number, attempts: number },  // required, non-negative ints
 *   routerOverheadTokens: number                   // required, >= 0
 * }
 */

function isNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

/**
 * Validate a metrics record against the shared contract. Never throws.
 *
 * @param {any} record
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateRecord(record) {
  const errors = [];

  if (record === null || typeof record !== "object") {
    return { valid: false, errors: ["record must be an object"] };
  }

  // runId
  if (typeof record.runId !== "string" || record.runId.length === 0) {
    errors.push("runId must be a non-empty string");
  }

  // taskClass (optional)
  if (record.taskClass !== undefined && typeof record.taskClass !== "string") {
    errors.push("taskClass, if present, must be a string");
  }

  // tokens
  if (record.tokens === null || typeof record.tokens !== "object") {
    errors.push("tokens must be an object with single and multi");
  } else {
    if (!isNumber(record.tokens.single) || record.tokens.single <= 0) {
      errors.push("tokens.single must be a positive number");
    }
    if (!isNumber(record.tokens.multi) || record.tokens.multi <= 0) {
      errors.push("tokens.multi must be a positive number");
    }
  }

  // quality
  if (record.quality === null || typeof record.quality !== "object") {
    errors.push("quality must be an object with single and multi");
  } else {
    if (!isNumber(record.quality.single)) {
      errors.push("quality.single must be a number");
    }
    if (!isNumber(record.quality.multi)) {
      errors.push("quality.multi must be a number");
    }
  }

  // retries
  if (record.retries === null || typeof record.retries !== "object") {
    errors.push("retries must be an object with count and attempts");
  } else {
    if (!isNonNegativeInt(record.retries.count)) {
      errors.push("retries.count must be a non-negative integer");
    }
    if (!isNonNegativeInt(record.retries.attempts)) {
      errors.push("retries.attempts must be a non-negative integer");
    }
  }

  // routerOverheadTokens
  if (!isNumber(record.routerOverheadTokens) || record.routerOverheadTokens < 0) {
    errors.push("routerOverheadTokens must be a number >= 0");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compute derived metrics from a valid record. Throws if the record is invalid.
 *
 * tokenReductionPct = (single - multi) / single * 100  (negative if multi worse)
 * qualityDropPct    = (single - multi) / single * 100  (negative if multi better)
 * retries              — passed through as-is
 * routerOverheadTokens — kept as its OWN line item, NEVER netted into savings
 *
 * @param {object} record
 * @returns {{runId: string, taskClass: (string|undefined), tokenReductionPct: number, qualityDropPct: number, retries: object, routerOverheadTokens: number}}
 */
export function computeRun(record) {
  const { valid, errors } = validateRecord(record);
  if (!valid) {
    throw new Error(`invalid metrics record: ${errors.join("; ")}`);
  }

  const tokenReductionPct =
    ((record.tokens.single - record.tokens.multi) / record.tokens.single) * 100;
  const qualityDropPct =
    ((record.quality.single - record.quality.multi) / record.quality.single) * 100;

  return {
    runId: record.runId,
    taskClass: record.taskClass,
    tokenReductionPct,
    qualityDropPct,
    retries: record.retries,
    routerOverheadTokens: record.routerOverheadTokens,
  };
}

/**
 * Validate then append a record as one JSON line to a JSONL log. Creates the
 * directory if missing. Returns computeRun(record). A bad record throws and is
 * NOT written.
 *
 * @param {object} record
 * @param {{logPath?: string}} [opts] - logPath overrides the default path.
 * @returns {object} the computed metrics (see computeRun)
 */
export function recordRun(record, opts = {}) {
  const { valid, errors } = validateRecord(record);
  if (!valid) {
    throw new Error(`refusing to write invalid metrics record: ${errors.join("; ")}`);
  }

  const logPath = opts.logPath || DEFAULT_LOG_PATH;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(record) + "\n", "utf8");

  return computeRun(record);
}

/**
 * Return a copy of `record` with routerOverheadTokens filled from the router
 * judgment log via summarizeOverhead(). Demonstrates reuse of the existing
 * overhead report. Overhead stays a separate line item — this only populates
 * the field, it does not net it against anything.
 *
 * @param {object} record
 * @param {{overheadLogPath?: string}} [opts]
 * @returns {object} a shallow copy of record with routerOverheadTokens set
 */
export function withRouterOverhead(record, opts = {}) {
  const { totalEstimatedTokens } = summarizeOverhead({ logPath: opts.overheadLogPath });
  return { ...record, routerOverheadTokens: totalEstimatedTokens };
}
