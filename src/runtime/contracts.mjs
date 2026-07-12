import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(here, "..", "..", "config", "execution-contracts.json");
const MODES = new Set([
  "single-agent",
  "multi-agent",
  "retrieval-only",
  "plan-only",
  "plan-then-execute",
  "review-only",
  "background",
  "candidate-race",
]);

export function loadContracts(path = DEFAULT_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed.defaults || !parsed.categories) throw new Error("execution contracts require defaults and categories");
  return parsed;
}

export function resolveContract(category, opts = {}) {
  const config = opts.config || loadContracts(opts.path);
  const categoryContract = config.categories[category] || {};
  const contract = { ...config.defaults, ...categoryContract, ...(opts.override || {}) };
  if (!MODES.has(contract.mode)) throw new Error(`unsupported execution mode "${contract.mode}"`);
  for (const key of ["timeoutMs", "maxInputTokens", "maxOutputTokens", "maxTurns", "maxRetries", "maxToolCalls", "maxRetrievalFiles", "maxRetrievalTokens"]) {
    if (!Number.isFinite(contract[key]) || contract[key] < 0) throw new Error(`invalid execution contract ${key}`);
  }
  if (!Array.isArray(contract.requiredChecks) || contract.requiredChecks.length === 0) {
    throw new Error("execution contract must define at least one required check");
  }
  return Object.freeze(contract);
}

export { MODES };
