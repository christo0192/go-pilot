// Tests for the rtk-backed "compressed" tier.
//
// The FALLBACK path is tested deterministically here (no rtk needed): pointing
// at a nonexistent binary or forcing fallback must degrade to the guard
// truncate stub WITHOUT throwing. The live rtk path (which needs `rtk` on PATH)
// lives in the sibling ./rtk-compress.live.test.mjs so this file stays hermetic.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compressOrFallback,
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
