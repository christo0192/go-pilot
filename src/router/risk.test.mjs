import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "./risk.mjs";

test("deterministic tasks route to deepseek", () => {
  for (const t of [
    "Implement merge_intervals in Python and add unit tests",
    "calculate the compound interest over 5 years",
    "extract all invoice fields to JSON",
  ]) {
    const r = classifyRisk(t);
    assert.equal(r.route, "deepseek", t);
    assert.equal(r.risk, "deterministic", t);
  }
});

test("creative routes to kimi", () => {
  const r = classifyRisk("write a catchy slogan for the launch");
  assert.equal(r.route, "kimi");
  assert.equal(r.risk, "creative");
});

test("subjective/executive routes to frontier-final", () => {
  const r = classifyRisk("give me an executive recommendation: should we scale channel A?");
  assert.equal(r.route, "frontier-final");
  assert.equal(r.risk, "subjective");
});

test("long pasted context dominates non-deterministic tasks", () => {
  const long = "summarize the key points of this transcript\n" + "x".repeat(13_000);
  const r = classifyRisk(long);
  assert.equal(r.risk, "long-context");
  assert.equal(r.route, "kimi");
});

test("long context does NOT override plainly deterministic work", () => {
  const long = "fix the bug in this code and add a unit test\n" + "x".repeat(13_000);
  const r = classifyRisk(long);
  assert.equal(r.risk, "deterministic");
  assert.equal(r.route, "deepseek");
});

test("no signal falls back to deepseek with low confidence", () => {
  const r = classifyRisk("please handle the thing we discussed");
  assert.equal(r.route, "deepseek");
  assert.equal(r.confidence, "low");
});
