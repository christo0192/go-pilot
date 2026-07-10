// Per-worker tool subsets (Step 2.3).
//
// Each router work-category (see config/router.json) gets a MINIMAL, correct
// allowlist of Pi built-in tool names instead of all 7 tools. This module loads
// those profiles and turns a category into the Pi CLI flags that constrain a
// worker to exactly its tools (least privilege).
//
// PURE: loadToolProfiles does the single file read; piToolArgs is a deterministic
// pure function of (category, profiles) — same input, same output, no I/O.
//
// Pi built-in tools (confirmed from pi-coding-agent source, createAllTools):
//   read, write, edit, bash, grep, find, ls   (NB: file-finding is `find`, not `glob`)
// Pi controls them via `--tools/-t <csv>` (allowlist) or `--no-tools/-nt`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Repo root = two levels up from src/router/ .
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_PROFILES_PATH = resolve(REPO_ROOT, "config", "tool-profiles.json");

// The exact set of Pi built-in tool names. Any profile referencing a name
// outside this set is a config bug (a made-up tool Pi would silently ignore).
const PI_BUILTIN_TOOLS = Object.freeze([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
]);

/**
 * Load and return the tool-profiles config object.
 * @param {string} [path] - overrides the default config/tool-profiles.json.
 * @returns {{categories: object, default: {tools: string[]}}} parsed profiles.
 * @throws {Error} on unreadable / invalid JSON, or a structurally invalid file.
 */
export function loadToolProfiles(path) {
  const profilesPath = path || DEFAULT_PROFILES_PATH;
  let raw;
  try {
    raw = readFileSync(profilesPath, "utf8");
  } catch (err) {
    throw new Error(`tool-profiles: cannot read config at ${profilesPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`tool-profiles: invalid JSON in ${profilesPath}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`tool-profiles: config in ${profilesPath} is not an object`);
  }
  if (!parsed.default || !Array.isArray(parsed.default.tools)) {
    throw new Error(`tool-profiles: config in ${profilesPath} is missing a valid "default.tools" array`);
  }
  if (!parsed.categories || typeof parsed.categories !== "object") {
    throw new Error(`tool-profiles: config in ${profilesPath} is missing a "categories" object`);
  }
  return parsed;
}

/**
 * Resolve the profile entry for a category, falling back to `default`.
 * @param {string} category
 * @param {{profiles: object}} opts
 * @returns {{tools: string[], rationale?: string, category: string, fromDefault: boolean}}
 */
export function resolveProfile(category, opts = {}) {
  const profiles = opts.profiles;
  if (!profiles || typeof profiles !== "object") {
    throw new Error("tool-profiles: resolveProfile requires opts.profiles (call loadToolProfiles first)");
  }
  const categories = profiles.categories || {};
  const hasEntry =
    typeof category === "string" &&
    Object.prototype.hasOwnProperty.call(categories, category) &&
    Array.isArray(categories[category].tools);

  const entry = hasEntry ? categories[category] : profiles.default;
  return {
    category: hasEntry ? category : "default",
    tools: entry.tools.slice(), // fresh array — never leak the config's mutable ref
    rationale: entry.rationale,
    fromDefault: !hasEntry,
  };
}

/**
 * Turn a work-category into the Pi CLI args that constrain a worker to exactly
 * that category's tool subset.
 *
 * @param {string} category - a router work-category (orchestrate, code, extract, ...).
 * @param {{profiles: object}} opts - opts.profiles from loadToolProfiles().
 * @returns {string[]} Pi CLI args, e.g. ["--tools","read,grep,find"] or ["--no-tools"].
 *
 * Deterministic. Unknown/missing category -> the `default` profile.
 * A profile with an empty tools array -> ["--no-tools"] (disable everything).
 */
export function piToolArgs(category, opts = {}) {
  const { tools } = resolveProfile(category, opts);
  if (tools.length === 0) {
    return ["--no-tools"];
  }
  return ["--tools", tools.join(",")];
}

export { PI_BUILTIN_TOOLS, DEFAULT_PROFILES_PATH };
