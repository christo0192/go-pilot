#!/usr/bin/env node
// Add newly introduced keys from an env template without changing any existing
// value. This gives installer-managed checkouts a safe configuration migration
// path while preserving user secrets and local overrides.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const [templatePath, targetPath] = process.argv.slice(2);
if (!templatePath || !targetPath) {
  console.error("usage: merge-env-defaults.mjs <template.env> <target.env>");
  process.exit(2);
}

const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const templateLines = readFileSync(templatePath, "utf8").split(/\r?\n/);
const target = readFileSync(targetPath, "utf8");
const present = new Set(
  target.split(/\r?\n/).map((line) => line.match(assignment)?.[1]).filter(Boolean),
);
const missing = templateLines.filter((line) => {
  const name = line.match(assignment)?.[1];
  return name && !present.has(name);
});

if (missing.length > 0) {
  const separator = target.endsWith("\n") ? "" : "\n";
  const block = `\n# Added by a Go-pilot configuration update.\n${missing.join("\n")}\n`;
  writeFileSync(targetPath, target + separator + block, { mode: 0o600 });
}
chmodSync(targetPath, 0o600);
process.stdout.write(JSON.stringify({ added: missing.map((line) => line.match(assignment)[1]) }) + "\n");
