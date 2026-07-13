// Key hygiene gate: no script may PRINT the value of a secret env var.
// Catches `echo "$WORKHORSE_GATEWAY_KEY"`, `console.log(process.env.X_KEY)`, etc.
// Printing the NAME of a key var (instructions, todos) is fine — only value
// expansion inside a print statement fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILES = [
  "install.sh",
  ...readdirSync(join(ROOT, "scripts")).filter((f) => /\.(sh|mjs)$/.test(f)).map((f) => `scripts/${f}`),
  ...readdirSync(join(ROOT, "scripts/baseline-rig")).filter((f) => /\.(sh|mjs)$/.test(f)).map((f) => `scripts/baseline-rig/${f}`),
];

// Print-statement containing an EXPANSION of a *KEY/*TOKEN/*SECRET variable.
const SH_LEAK = /\b(echo|printf)\b[^\n]*\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET)\b/;
const JS_LEAK = /\bconsole\.(log|error|warn|info)\([^\n]*(process\.env\.[A-Za-z_]*(KEY|TOKEN|SECRET)\b|\bKEY\b)/;

test("no script prints secret values", () => {
  const leaks = [];
  for (const rel of FILES) {
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("#") || t.startsWith("//")) return;
      if (SH_LEAK.test(line) || JS_LEAK.test(line)) leaks.push(`${rel}:${i + 1}: ${t.slice(0, 120)}`);
    });
  }
  assert.deepEqual(leaks, [], `secret value printed:\n${leaks.join("\n")}`);
});
