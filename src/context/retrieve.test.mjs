import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieveContext, _resetRgAvailability } from "./retrieve.mjs";

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-retrieve-"));
  tmpDirs.push(dir);
  return dir;
}

test("retrieveContext returns bounded relevant files (works with rg OR the fs fallback)", () => {
  _resetRgAvailability();
  const dir = fixtureDir();
  writeFileSync(join(dir, "router.mjs"), "export function routeTask() { return 'route'; }\n");
  writeFileSync(join(dir, "other.txt"), "unrelated material\n");
  const out = retrieveContext("routeTask router", { cwd: dir, maxFiles: 2, maxTokens: 100 });
  assert.equal(out.files[0].file, "router.mjs");
  assert.ok(out.tokens <= 100);
});

test("degrade-safe: an injected searcher drives retrieval hermetically (no rg, no fs walk)", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "a.mjs"), "alpha widget\n");
  writeFileSync(join(dir, "b.mjs"), "beta widget\n");
  // The injected searcher stands in for rg/fs entirely — deterministic on any host.
  const searcher = (term) => (term === "widget" ? ["a.mjs", "b.mjs"] : []);
  const out = retrieveContext("widget", { cwd: dir, maxFiles: 5, searcher });
  assert.deepEqual(out.files.map((f) => f.file).sort(), ["a.mjs", "b.mjs"]);
  assert.ok(out.tokens > 0);
});

test("token budget bounds selection", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "big.mjs"), "x".repeat(2000) + "\n");
  writeFileSync(join(dir, "small.mjs"), "tiny\n");
  const searcher = () => ["big.mjs", "small.mjs"];
  // maxTokens tiny -> big.mjs (500 tokens) is skipped, small.mjs fits.
  const out = retrieveContext("anything", { cwd: dir, maxFiles: 5, maxTokens: 10, searcher });
  assert.ok(out.tokens <= 10);
  assert.ok(!out.files.some((f) => f.file === "big.mjs"), "over-budget file excluded");
});
