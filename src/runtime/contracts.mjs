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

// Governance taxonomy for multi-pane modes. The two axes are DELIBERATELY
// distinct:
//   - efficiencyGated: makes the token-efficiency claim the sign-off (D17)
//     exists to verify; a class not signed off is downgraded to single-agent.
//   - costOptIn: trades MORE tokens for reliability (it never claims savings),
//     so it is NOT sign-off-gated — instead it requires explicit cost approval
//     (allowParallelCost) so 2x spend is never accidental.
const PARALLEL_MODES = new Set(["multi-agent", "candidate-race"]);
const EFFICIENCY_GATED_MODES = new Set(["multi-agent"]);
const COST_OPT_IN_MODES = new Set(["candidate-race"]);

export function modeGovernance(mode) {
  return {
    parallel: PARALLEL_MODES.has(mode),
    efficiencyGated: EFFICIENCY_GATED_MODES.has(mode),
    costOptIn: COST_OPT_IN_MODES.has(mode),
  };
}

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
  for (const key of ["timeoutMs", "maxInputTokens", "maxOutputTokens", "maxTurns", "maxRetries", "maxToolCalls", "maxRetrievalFiles", "maxRetrievalTokens", "maxRetrievalChunkTokens", "minRetrievalScore", "minRetrievalTerms"]) {
    if (!Number.isFinite(contract[key]) || contract[key] < 0) throw new Error(`invalid execution contract ${key}`);
  }
  if (!Array.isArray(contract.requiredChecks) || contract.requiredChecks.length === 0) {
    throw new Error("execution contract must define at least one required check");
  }
  return Object.freeze(contract);
}

export { MODES, PARALLEL_MODES, EFFICIENCY_GATED_MODES, COST_OPT_IN_MODES };
