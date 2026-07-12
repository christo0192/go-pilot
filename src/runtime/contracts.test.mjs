import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContract } from "./contracts.mjs";

test("resolveContract merges defaults and category policy", () => {
  const contract = resolveContract("code");
  assert.equal(contract.mode, "single-agent");
  assert.ok(contract.timeoutMs > 0);
  assert.ok(contract.requiredChecks.includes("no-placeholders"));
});

test("resolveContract rejects empty validation contracts", () => {
  assert.throws(() => resolveContract("code", { override: { requiredChecks: [] } }), /at least one/);
});
