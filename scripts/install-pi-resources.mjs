#!/usr/bin/env node
// Merge Go-pilot's bundled skills and extension into Pi's global settings
// without clobbering any existing user resources.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [settingsArg, rootArg] = process.argv.slice(2);
if (!settingsArg || !rootArg) {
  process.stderr.write("usage: install-pi-resources.mjs <settings.json> <gopilot-root>\n");
  process.exit(2);
}

const settingsPath = resolve(settingsArg);
const root = resolve(rootArg);
let settings = {};
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    process.stderr.write(`cannot merge invalid Pi settings ${settingsPath}: ${error.message}\n`);
    process.exit(1);
  }
}
if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  process.stderr.write(`Pi settings must contain a JSON object: ${settingsPath}\n`);
  process.exit(1);
}

function addUnique(key, value) {
  if (settings[key] == null) settings[key] = [];
  if (!Array.isArray(settings[key])) {
    process.stderr.write(`Pi settings field "${key}" must be an array; refusing to overwrite it\n`);
    process.exit(1);
  }
  if (!settings[key].includes(value)) settings[key].push(value);
}

addUnique("skills", resolve(root, ".pi", "skills"));
addUnique("extensions", resolve(root, ".pi", "extensions", "tool-call-repair.ts"));

mkdirSync(dirname(settingsPath), { recursive: true });
const temporary = `${settingsPath}.gopilot-${process.pid}.tmp`;
writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
renameSync(temporary, settingsPath);
try { chmodSync(settingsPath, 0o600); } catch {}
process.stdout.write(`merged Go-pilot skills and extensions into ${settingsPath}\n`);
