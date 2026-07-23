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

test("retrieval injects matching chunks instead of an unrelated file prefix", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "guide.md"), `# Unrelated\n${"cold filler\n".repeat(80)}# Mem0 setup\nMEM0_BASE_URL enables durable recall.\n`);
  const out = retrieveContext("Mem0 durable recall", { cwd: dir, maxTokens: 100, searcher: () => ["guide.md"] });
  assert.match(out.text, /MEM0_BASE_URL enables durable recall/);
  assert.doesNotMatch(out.text, /cold filler/);
  assert.equal(out.chunks.length, 1);
});

test("identical chunks from duplicate files are injected once", () => {
  const dir = fixtureDir();
  const content = "# Cache policy\nStable cache prefixes reduce fresh tokens.\n";
  writeFileSync(join(dir, "a.md"), content);
  writeFileSync(join(dir, "b.md"), content);
  const out = retrieveContext("stable cache prefixes", { cwd: dir, searcher: () => ["a.md", "b.md"] });
  assert.equal(out.chunks.length, 1);
  assert.equal(out.droppedDuplicates, 1);
});

test("default retrieval budget is 2000 tokens", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "large.md"), `# Cache\n${"cache evidence ".repeat(2000)}`);
  const out = retrieveContext("cache evidence", { cwd: dir, searcher: () => ["large.md"] });
  assert.ok(out.tokens <= 2000);
});

test("a configured meaningful-term floor suppresses trivial probe retrieval", () => {
  const dir = fixtureDir();
  writeFileSync(join(dir, "mesh.test.mjs"), "const pong = true;\n");
  const out = retrieveContext("pong", { cwd: dir, minQueryTerms: 2, searcher: () => ["mesh.test.mjs"] });
  assert.equal(out.tokens, 0);
  assert.deepEqual(out.files, []);
});
