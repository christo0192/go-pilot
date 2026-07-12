import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inputsText, naivePrompt, runKey, hashSeed, armOrderFor, buildRunPlan, pendingRuns,
} from "./campaign.mjs";

test("naivePrompt concatenates prompt + inputs verbatim", () => {
  const fx = { prompt: "Answer this", inputs: [{ name: "doc", content: "BODY" }] };
  assert.equal(naivePrompt(fx), "Answer this\n\n[doc]\nBODY");
  assert.equal(naivePrompt({ prompt: "P", inputs: [] }), "P");
  assert.equal(inputsText({ inputs: [] }), "");
});

test("runKey and hashSeed are stable", () => {
  assert.equal(runKey("math-01", 2, "A"), "math-01:t2:A");
  assert.equal(hashSeed("math-01:1"), hashSeed("math-01:1"));
  assert.notEqual(hashSeed("math-01:1"), hashSeed("math-01:2"));
});

test("armOrderFor is a deterministic permutation of A/B/C", () => {
  const o1 = armOrderFor("math-01", 1, 123);
  const o2 = armOrderFor("math-01", 1, 123);
  assert.deepEqual(o1, o2); // deterministic
  assert.deepEqual([...o1].sort(), ["A", "B", "C"]); // valid permutation
  // Different seed or trial generally reshuffles.
  const varied = new Set([
    armOrderFor("math-01", 1, 1).join(""),
    armOrderFor("math-01", 2, 1).join(""),
    armOrderFor("math-02", 1, 1).join(""),
    armOrderFor("math-01", 1, 999).join(""),
  ]);
  assert.ok(varied.size >= 2); // not all identical
});

test("buildRunPlan yields fixtures x trials x 3 arms with recorded order", () => {
  const fixtures = [{ id: "a" }, { id: "b" }];
  const plan = buildRunPlan(fixtures, { trials: 3, seed: 42 });
  assert.equal(plan.length, 2 * 3 * 3);
  // Each (fixture,trial) triple contains exactly one of each arm.
  const triple = plan.filter((r) => r.fixtureId === "a" && r.trial === 1);
  assert.deepEqual(triple.map((r) => r.arm).sort(), ["A", "B", "C"]);
  assert.equal(triple[0].armOrder.length, 3);
  // The plan's within-triple order matches armOrder.
  assert.equal(triple.map((r) => r.arm).join(""), triple[0].armOrder);
});

test("buildRunPlan is fully reproducible for a fixed seed", () => {
  const fixtures = [{ id: "a" }, { id: "b" }];
  const p1 = buildRunPlan(fixtures, { trials: 2, seed: 7 }).map((r) => runKey(r.fixtureId, r.trial, r.arm));
  const p2 = buildRunPlan(fixtures, { trials: 2, seed: 7 }).map((r) => runKey(r.fixtureId, r.trial, r.arm));
  assert.deepEqual(p1, p2);
});

test("pendingRuns removes completed keys (resume)", () => {
  const fixtures = [{ id: "a" }];
  const plan = buildRunPlan(fixtures, { trials: 1, seed: 1 });
  const completed = new Set([runKey("a", 1, "A")]);
  const pending = pendingRuns(plan, completed);
  assert.equal(pending.length, 2); // B and C remain
  assert.ok(!pending.some((r) => r.arm === "A"));
});
