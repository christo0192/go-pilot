import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContract, modeGovernance } from "./contracts.mjs";

test("resolveContract merges defaults and category policy", () => {
  const contract = resolveContract("code");
  assert.equal(contract.mode, "single-agent");
  assert.ok(contract.timeoutMs > 0);
  assert.ok(contract.requiredChecks.includes("no-placeholders"));
});

test("resolveContract rejects empty validation contracts", () => {
  assert.throws(() => resolveContract("code", { override: { requiredChecks: [] } }), /at least one/);
});

test("modeGovernance separates efficiency-gated from cost-opt-in parallel modes", () => {
  // multi-agent: parallel AND efficiency-gated (sign-off), NOT cost-opt-in.
  assert.deepEqual(modeGovernance("multi-agent"), { parallel: true, efficiencyGated: true, costOptIn: false });
  // candidate-race: parallel AND cost-opt-in, NOT efficiency-gated.
  assert.deepEqual(modeGovernance("candidate-race"), { parallel: true, efficiencyGated: false, costOptIn: true });
  // single-agent: none.
  assert.deepEqual(modeGovernance("single-agent"), { parallel: false, efficiencyGated: false, costOptIn: false });
});
