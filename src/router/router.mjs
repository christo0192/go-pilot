// Deterministic rule-based router.
//
// Given a task, decides which PLANE + MODEL runs it, purely from a
// profile-keyed config. LLM judgment is the costed exception (logged
// separately). This module is PURE: same input -> same output, no I/O,
// no clock/random in the decision path. It does NOT dispatch panes; it
// only returns the decision. The only side effect permitted is the
// caller-supplied onJudgment hook.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Sentinel: a mapping value of this string means "no deterministic rule,
// escalate to LLM judgment".
const JUDGMENT = "__judgment__";

// Category name that always forces the judgment path even if (somehow)
// present in a config.
const AMBIGUOUS = "ambiguous";

// Explicit, flat token estimate for one judgment call. Kept as a small
// constant so every judgment record is self-contained and summable; it is
// deliberately NOT netted against any "savings" figure. 1500 tokens is a
// sane order-of-magnitude for a short routing deliberation (task prompt +
// a compact reasoning turn) — tune in one place if the model changes.
const JUDGMENT_ESTIMATED_TOKENS = 1500;

// Repo root = two levels up from src/router/ .
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_CONFIG_PATH = resolve(REPO_ROOT, "config", "router.json");

/**
 * Load and return the mapping object for a single profile.
 * @param {string} profile - profile key, e.g. "pure-anthropic".
 * @param {{configPath?: string}} [opts] - configPath overrides the default.
 * @returns {{categories: object, default: string}} the profile's mapping.
 * @throws {Error} on unknown profile or unreadable/invalid config.
 */
export function loadConfig(profile, opts = {}) {
  const configPath = opts.configPath || DEFAULT_CONFIG_PATH;
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(`router: cannot read config at ${configPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`router: invalid JSON in ${configPath}: ${err.message}`);
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, profile)) {
    const known = Object.keys(parsed).join(", ") || "(none)";
    throw new Error(`router: unknown profile "${profile}". Known profiles: ${known}`);
  }
  return parsed[profile];
}

/**
 * Route a task to a { plane, model } decision.
 *
 * @param {{id?: string, category?: string, prompt?: string}} task
 * @param {{profile: string, config?: object, onJudgment?: Function, configPath?: string}} opts
 * @returns {object} deterministic decision or judgment decision.
 *
 * Deterministic (known category):
 *   { category, plane, model, deterministic: true }
 * Judgment (unknown/missing category, "ambiguous", or "__judgment__"):
 *   { category, deterministic: false, needsJudgment: true, judgmentCost }
 */
export function route(task = {}, opts = {}) {
  const { profile, onJudgment } = opts;
  // Load config once, up front. Everything after this is pure computation.
  const mapping = opts.config || loadConfig(profile, opts);

  const category = task.category;
  const categories = mapping.categories || {};

  // Look up the deterministic rule (guarding against prototype keys).
  const hasRule =
    typeof category === "string" &&
    category !== AMBIGUOUS &&
    Object.prototype.hasOwnProperty.call(categories, category);
  const rule = hasRule ? categories[category] : undefined;

  // Judgment path: no category, ambiguous, no rule, or explicit sentinel.
  if (!rule || rule === JUDGMENT) {
    const decision = {
      category: category ?? null,
      deterministic: false,
      needsJudgment: true,
      judgmentCost: { estimatedTokens: JUDGMENT_ESTIMATED_TOKENS },
    };
    if (typeof onJudgment === "function") {
      onJudgment(task);
    }
    return decision;
  }

  // Deterministic path: return a fresh object each call (purity: no shared
  // mutable references leak from the config).
  return {
    category,
    plane: rule.plane,
    model: rule.model,
    ...(rule.fallback ? { fallback: { ...rule.fallback } } : {}),
    deterministic: true,
  };
}

export { JUDGMENT_ESTIMATED_TOKENS };
