#!/usr/bin/env node
import { chmodSync, readFileSync, writeFileSync } from "node:fs";

const [path, name] = process.argv.slice(2);
if (!path || !name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
  console.error("usage: set-env-key.mjs <env-file> <UPPERCASE_NAME>");
  process.exit(2);
}
const value = process.env.GOPILOT_WORKHORSE_KEY;
if (!value || /[\r\n\0]/.test(value)) {
  console.error("GOPILOT_WORKHORSE_KEY is empty or contains a forbidden newline/NUL");
  process.exit(2);
}

let text = readFileSync(path, "utf8");
const pattern = new RegExp(`^${name}=.*$`, "m");
const line = `${name}=${value}`;
text = pattern.test(text)
  ? text.replace(pattern, () => line)
  : `${text}${text.endsWith("\n") ? "" : "\n"}${line}\n`;
writeFileSync(path, text, { mode: 0o600 });
chmodSync(path, 0o600);
