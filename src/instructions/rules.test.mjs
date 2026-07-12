import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstructions } from "./rules.mjs";

test("discoverInstructions applies parent then nearest rules", () => {
  const root = mkdtempSync(join(tmpdir(), "gopilot-rules-"));
  const child = join(root, "src");
  mkdirSync(child);
  writeFileSync(join(root, "AGENTS.md"), "root rule");
  writeFileSync(join(child, "AGENTS.md"), "child rule");
  const out = discoverInstructions(child, { root });
  assert.equal(out.files.length, 2);
  assert.ok(out.text.indexOf("root rule") < out.text.indexOf("child rule"));
});
