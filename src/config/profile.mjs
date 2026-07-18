import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..");
const DEFAULT_RUNTIME_PATH = resolve(ROOT, "config", "runtime.json");
const DEFAULT_ENV_PATH = resolve(ROOT, "deploy", ".env");

export function parseEnvFile(text) {
  const values = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  }
  return values;
}

export function loadRuntimeConfig(path = DEFAULT_RUNTIME_PATH) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed.defaultProfile || typeof parsed.defaultProfile !== "string") {
    throw new Error("runtime config requires a string defaultProfile");
  }
  return parsed;
}

export function selectProfile({ cliProfile, env = process.env, envPath = DEFAULT_ENV_PATH, runtimePath = DEFAULT_RUNTIME_PATH } = {}) {
  if (cliProfile) return cliProfile;
  if (env.GOPILOT_PROFILE) return env.GOPILOT_PROFILE;
  if (existsSync(envPath)) {
    const fileProfile = parseEnvFile(readFileSync(envPath, "utf8")).GOPILOT_PROFILE;
    if (fileProfile) return fileProfile;
  }
  return loadRuntimeConfig(runtimePath).defaultProfile;
}

export { DEFAULT_RUNTIME_PATH, DEFAULT_ENV_PATH };
