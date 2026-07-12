import { test } from "node:test";
import assert from "node:assert/strict";
import { runBenchmark } from "./runner.mjs";

test("runBenchmark executes every fixture, strategy, and trial", async () => {
  const out = await runBenchmark([{ id: "a" }, { id: "b" }], ["single", "multi"], {
    trials: 2,
    run: async () => ({ ok: true }),
  });
  assert.equal(out.outcomes.length, 8);
  assert.equal(out.acceptance, null);
});
