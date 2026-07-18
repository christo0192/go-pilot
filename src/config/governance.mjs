// Config & model governance (Step 8.13).
//
// The router decides plane+model from config/router.json. Governance makes that
// config TRUSTWORTHY before anything dispatches: it validates the router shape
// and cross-checks every routed model against a registry (config/models.json)
// that pins a version, declares capabilities, and carries an `active` flag.
//
// Fail-closed: a profile that routes to an unknown or INACTIVE model is an
// error, so an un-provisioned/uncredentialed model cannot be dispatched by
// surprise. `gopilot config doctor` surfaces all errors+warnings at once.
//
// Pure/deterministic (no clock/random); the only I/O is reading the JSON config.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_ROUTER_PATH = resolve(REPO_ROOT, "config", "router.json");
const DEFAULT_REGISTRY_PATH = resolve(REPO_ROOT, "config", "models.json");

export const PLANES = new Set(["frontier", "workhorse"]);
const REQUIRED_CAP_KEYS = ["tools", "jsonSchema", "contextWindow", "streaming"];
const JUDGMENT = "__judgment__";

function readJson(path, label) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`${label}: cannot read ${path}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label}: invalid JSON in ${path}: ${err.message}`);
  }
}

/**
 * Load + shape-check the model registry.
 * @param {{registryPath?: string}} [opts]
 * @returns {{models: object}} the parsed registry (the `models` map is guaranteed present)
 * @throws {Error} on unreadable/invalid JSON or a missing `models` map
 */
export function loadModelRegistry(opts = {}) {
  const path = opts.registryPath || DEFAULT_REGISTRY_PATH;
  const parsed = readJson(path, "registry");
  if (!parsed || typeof parsed.models !== "object" || parsed.models === null) {
    throw new Error(`registry: ${path} must have a "models" object`);
  }
  return parsed;
}

/**
 * Resolve a routed model alias to its registry entry (provider, pinned version,
 * plane, capabilities). Use this to RECORD the resolved model/provider per run.
 * @param {string} alias  e.g. "sonnet", "qwen-coder"
 * @param {{registry?: object, registryPath?: string, allowInactive?: boolean}} [opts]
 * @returns {{model: string, provider: string, version: string, plane: string, capabilities: object, active: boolean}}
 * @throws {Error} on unknown or (unless allowInactive) inactive model
 */
export function resolveModel(alias, opts = {}) {
  const registry = opts.registry || loadModelRegistry(opts);
  const entry = Object.prototype.hasOwnProperty.call(registry.models, alias)
    ? registry.models[alias]
    : undefined;
  if (!entry) {
    const known = Object.keys(registry.models).join(", ") || "(none)";
    throw new Error(`resolveModel: unknown model "${alias}". Known: ${known}`);
  }
  if (!entry.active && !opts.allowInactive) {
    throw new Error(`resolveModel: model "${alias}" is inactive (fail-closed)`);
  }
  return {
    model: alias,
    provider: entry.provider,
    version: entry.version,
    plane: entry.plane,
    capabilities: entry.capabilities,
    active: entry.active === true,
  };
}

// Validate a single registry entry's shape; returns an array of error strings.
function registryEntryErrors(alias, entry) {
  const errs = [];
  const at = `registry model "${alias}"`;
  if (!entry || typeof entry !== "object") return [`${at}: not an object`];
  if (typeof entry.provider !== "string" || entry.provider === "") errs.push(`${at}: missing provider`);
  if (typeof entry.version !== "string" || entry.version === "") errs.push(`${at}: missing pinned version`);
  if (!PLANES.has(entry.plane)) errs.push(`${at}: plane must be one of ${[...PLANES].join("|")} (got ${JSON.stringify(entry.plane)})`);
  if (typeof entry.active !== "boolean") errs.push(`${at}: "active" must be a boolean`);
  const caps = entry.capabilities;
  if (!caps || typeof caps !== "object") {
    errs.push(`${at}: missing capabilities object`);
  } else {
    for (const k of REQUIRED_CAP_KEYS) {
      if (!(k in caps)) errs.push(`${at}: capabilities missing "${k}"`);
    }
    if ("contextWindow" in caps && !(Number.isInteger(caps.contextWindow) && caps.contextWindow > 0)) {
      errs.push(`${at}: capabilities.contextWindow must be a positive integer`);
    }
  }
  return errs;
}

/**
 * Validate the full config surface (router + model registry) at once.
 *
 * @param {{routerPath?: string, registryPath?: string}} [opts]
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateConfig(opts = {}) {
  const errors = [];
  const warnings = [];

  let registry;
  try {
    registry = loadModelRegistry(opts);
  } catch (err) {
    return { ok: false, errors: [err.message], warnings };
  }

  let router;
  try {
    router = readJson(opts.routerPath || DEFAULT_ROUTER_PATH, "router");
  } catch (err) {
    return { ok: false, errors: [err.message], warnings };
  }

  // 1. Registry entries are well-formed.
  for (const [alias, entry] of Object.entries(registry.models)) {
    errors.push(...registryEntryErrors(alias, entry));
  }

  // 2. Router shape + cross-checks against the registry.
  for (const [profile, mapping] of Object.entries(router)) {
    const at = `profile "${profile}"`;
    if (!mapping || typeof mapping !== "object") {
      errors.push(`${at}: not an object`);
      continue;
    }
    const categories = mapping.categories;
    if (!categories || typeof categories !== "object") {
      errors.push(`${at}: missing "categories" object`);
      continue;
    }
    if (typeof mapping.default !== "string") {
      errors.push(`${at}: "default" must be a string (category or ${JUDGMENT})`);
    } else if (
      mapping.default !== JUDGMENT &&
      !Object.prototype.hasOwnProperty.call(categories, mapping.default)
    ) {
      warnings.push(`${at}: default "${mapping.default}" is neither ${JUDGMENT} nor a known category`);
    }

    for (const [category, rule] of Object.entries(categories)) {
      const cAt = `${at} category "${category}"`;
      if (!rule || typeof rule !== "object") {
        errors.push(`${cAt}: rule is not an object`);
        continue;
      }
      if (typeof rule.plane !== "string" || typeof rule.model !== "string") {
        errors.push(`${cAt}: rule needs string plane+model`);
        continue;
      }
      if (!PLANES.has(rule.plane)) {
        errors.push(`${cAt}: unknown plane "${rule.plane}"`);
      }
      const entry = Object.prototype.hasOwnProperty.call(registry.models, rule.model)
        ? registry.models[rule.model]
        : undefined;
      if (!entry) {
        errors.push(`${cAt}: routes to unknown model "${rule.model}" (add it to the registry)`);
        continue;
      }
      if (entry.active !== true) {
        errors.push(`${cAt}: routes to INACTIVE model "${rule.model}" (fail-closed)`);
      }
      if (entry.plane && entry.plane !== rule.plane) {
        errors.push(
          `${cAt}: plane mismatch — router says "${rule.plane}", registry pins "${rule.model}" to "${entry.plane}"`,
        );
      }
      if (rule.fallback != null) {
        const fallback = rule.fallback;
        const fAt = `${cAt} fallback`;
        if (!fallback || typeof fallback !== "object" || !PLANES.has(fallback.plane) || typeof fallback.model !== "string") {
          errors.push(`${fAt}: needs a valid plane+model`);
        } else {
          const fallbackEntry = Object.prototype.hasOwnProperty.call(registry.models, fallback.model)
            ? registry.models[fallback.model]
            : undefined;
          if (!fallbackEntry) errors.push(`${fAt}: routes to unknown model "${fallback.model}"`);
          else if (fallbackEntry.active !== true) errors.push(`${fAt}: routes to INACTIVE model "${fallback.model}"`);
          else if (fallbackEntry.plane !== fallback.plane) errors.push(`${fAt}: plane mismatch for "${fallback.model}"`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
