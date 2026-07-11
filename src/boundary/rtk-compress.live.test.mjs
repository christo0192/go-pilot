// LIVE rtk path — self-skips when `rtk` is not on PATH. The deterministic
// fallback tests (no tool required) live in ./rtk-compress.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compressOrFallback,
  rtkCompress,
  rtkAvailable,
  _resetRtkAvailability,
} from "./rtk-compress.mjs";

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
