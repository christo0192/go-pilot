// LIVE CCE path — self-skips when `cce` is absent or nothing is indexed.
// The deterministic fallback-ordering tests (no tool required) live in
// ./cce-retrieve.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  retrieve,
  cceAvailable,
  cceIndexed,
  _resetCceAvailability,
} from "./cce-retrieve.mjs";

const REPO = process.cwd();

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
