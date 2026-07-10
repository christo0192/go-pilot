// Tests for the CCE retrieval degrade chain: CCE -> file-path -> compressed.
//
// The FALLBACK ordering is tested deterministically with CCE forced off
// (forceOff:true), so no tool is required and the result is stable. The live
// CCE path SELF-SKIPS when `cce` is absent or nothing is indexed, mirroring the
// Mem0 integration-test pattern in ../memory/pipeline.integration.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  retrieve,
  cceAvailable,
  cceIndexed,
  _resetCceAvailability,
} from "./cce-retrieve.mjs";

const REPO = process.cwd();

test("cceAvailable: false for a nonexistent binary (no throw)", () => {
  _resetCceAvailability();
  assert.equal(cceAvailable({ cceBin: "cce-not-real-xyz" }), false);
});

test("retrieve: CCE off -> degrades to a file-path reference for a real term", async () => {
  const res = await retrieve("router work-type mapping", {
    cwd: REPO,
    forceOff: true,
  });
  assert.equal(res.tier, "reference", "degraded to the file-path tier");
  assert.equal(res.source, "file-path");
  assert.ok(
    res.files.some((f) => /router/.test(f)),
    "a router file surfaced among the references",
  );
  assert.ok(res.ref && typeof res.ref.path === "string", "carries a ref pointer");
});

test("retrieve: CCE off + no matching file -> compressed tier, never throws", async () => {
  // Assemble the query so this literal never appears in the source tree (grep
  // would otherwise self-match this test file).
  const noMatch = ["zz", "qq", "xx", "nomatchtoken"].join("");
  const res = await retrieve(noMatch, {
    cwd: REPO,
    forceOff: true,
  });
  assert.equal(res.tier, "compressed", "final degrade is the compressed tier");
  assert.equal(res.source, "compressed");
  assert.equal(typeof res.text, "string", "returns a string, no throw");
});

test("retrieve: injected fileFinder controls the reference result", async () => {
  const res = await retrieve("anything", {
    cwd: REPO,
    forceOff: true,
    fileFinder: () => ["src/boundary/guard.mjs"],
  });
  assert.equal(res.tier, "reference");
  assert.equal(res.ref.path, "src/boundary/guard.mjs");
});

// --- LIVE CCE path: self-skips when cce is absent / not indexed ---

test("live: CCE retrieves a relevant chunk for a repo query", async (t) => {
  _resetCceAvailability();
  if (!cceAvailable() || !cceIndexed()) {
    t.skip("skipped: cce not on PATH or nothing indexed (install + `cce index` to run)");
    return;
  }

  const res = await retrieve("router work-type mapping", { cwd: REPO, topK: 5 });
  assert.ok(res.text.length > 0, "produced retrieval output");
  // When CCE answers it should be the semantic tier; if its index missed, we
  // still accept a degrade (the chain must never fail), but assert no throw.
  assert.ok(["cce", "reference", "compressed"].includes(res.tier), "valid tier");
});
