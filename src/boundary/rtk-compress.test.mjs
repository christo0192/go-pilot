// Tests for the rtk-backed "compressed" tier.
//
// The FALLBACK path is tested deterministically (no rtk needed): pointing at a
// nonexistent binary or forcing fallback must degrade to the guard truncate
// stub WITHOUT throwing. The live rtk path SELF-SKIPS when `rtk` is not on
// PATH, mirroring the Mem0 integration-test pattern in
// ../memory/pipeline.integration.test.mjs so the suite stays green anywhere.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compressOrFallback,
  rtkCompress,
  rtkAvailable,
  _resetRtkAvailability,
} from "./rtk-compress.mjs";

const BOGUS = "rtk-does-not-exist-xyz-9999";

test("rtkAvailable: false for a nonexistent binary (no throw)", () => {
  _resetRtkAvailability();
  assert.equal(rtkAvailable({ rtkBin: BOGUS }), false);
});

test("compressOrFallback: rtk absent -> degrades to truncate stub, long output", async () => {
  // 5000 chars of deterministic output, threshold 800 -> truncated + marker.
  const cmd = `node -e "process.stdout.write('x'.repeat(5000))"`;
  const res = await compressOrFallback(cmd, { rtkBin: BOGUS, threshold: 800 });

  assert.equal(res.source, "truncate-fallback", "used the fallback, not rtk");
  assert.equal(res.tier, "compressed", "long output was compressed");
  assert.equal(res.flagged, true, "guard flagged the downgrade");
  assert.match(res.text, /chars elided/, "carries the elision marker");
  assert.ok(res.text.length < 5000, "output is shorter than the raw 5000 chars");
});

test("compressOrFallback: forceFallback short output passes through as full", async () => {
  const cmd = `node -e "process.stdout.write('hello world')"`;
  const res = await compressOrFallback(cmd, { forceFallback: true, threshold: 800 });

  assert.equal(res.source, "truncate-fallback");
  assert.equal(res.tier, "full", "under threshold -> full passthrough");
  assert.match(res.text, /hello world/);
});

test("compressOrFallback: never throws even when the raw command fails", async () => {
  const res = await compressOrFallback("this-command-does-not-exist-zzz", {
    rtkBin: BOGUS,
  });
  assert.ok(typeof res.text === "string", "returns a string, no throw");
  assert.equal(res.source, "truncate-fallback");
});

// --- LIVE rtk path: self-skips when rtk is absent ---

test("live: rtkCompress compresses git log below the raw size", async (t) => {
  _resetRtkAvailability();
  if (!rtkAvailable()) {
    t.skip("skipped: rtk not on PATH (install rtk to run this live test)");
    return;
  }

  const cwd = process.cwd();
  const { text } = await rtkCompress("git log -n 5", { cwd });
  assert.ok(text.length > 0, "rtk produced output");

  const res = await compressOrFallback("git log --stat -n 20", { cwd });
  assert.equal(res.source, "rtk", "live rtk path was taken");
  assert.ok(res.text.length > 0, "compressed output is non-empty");
});
