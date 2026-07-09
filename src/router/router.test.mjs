import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { route, loadConfig, JUDGMENT_ESTIMATED_TOKENS } from "./router.mjs";
import { logJudgment } from "./judgment-log.mjs";

const PROFILE = "pure-anthropic";

test("deterministic fixture: known categories map to exact {plane, model}", () => {
  const fixture = [
    { category: "orchestrate", plane: "frontier", model: "opus" },
    { category: "plan",        plane: "frontier", model: "opus" },
    { category: "code",        plane: "frontier", model: "sonnet" },
    { category: "analyze",     plane: "frontier", model: "sonnet" },
    { category: "draft",       plane: "frontier", model: "sonnet" },
    { category: "extract",     plane: "frontier", model: "haiku" },
    { category: "classify",    plane: "frontier", model: "haiku" },
    { category: "summarize",   plane: "frontier", model: "haiku" },
    { category: "code-review", plane: "frontier", model: "codex" },
    { category: "lateral",     plane: "frontier", model: "codex" },
  ];

  assert.ok(fixture.length >= 8, "fixture must span >= 8 tasks");

  for (const { category, plane, model } of fixture) {
    const decision = route({ category }, { profile: PROFILE });
    assert.deepEqual(
      decision,
      { category, plane, model, deterministic: true },
      `category "${category}" routed incorrectly`
    );
  }
});

test("unknown category -> judgment path + onJudgment called exactly once", () => {
  let calls = 0;
  const task = { id: "t-quux", category: "quux" };
  const decision = route(task, {
    profile: PROFILE,
    onJudgment: () => { calls += 1; },
  });

  assert.equal(decision.deterministic, false);
  assert.equal(decision.needsJudgment, true);
  assert.equal(decision.category, "quux");
  assert.deepEqual(decision.judgmentCost, { estimatedTokens: JUDGMENT_ESTIMATED_TOKENS });
  assert.equal(calls, 1, "onJudgment must be invoked exactly once");
});

test('category "ambiguous" -> judgment path', () => {
  let calls = 0;
  const decision = route(
    { id: "t-amb", category: "ambiguous" },
    { profile: PROFILE, onJudgment: () => { calls += 1; } }
  );
  assert.equal(decision.needsJudgment, true);
  assert.equal(decision.deterministic, false);
  assert.equal(decision.category, "ambiguous");
  assert.equal(calls, 1);
});

test("missing category -> judgment path", () => {
  const decision = route({ id: "t-none" }, { profile: PROFILE });
  assert.equal(decision.needsJudgment, true);
  assert.equal(decision.category, null);
});

test('"__judgment__" mapping value (empty profile) -> judgment path', () => {
  const decision = route({ category: "anything" }, { profile: "hybrid" });
  assert.equal(decision.needsJudgment, true);
  assert.equal(decision.deterministic, false);
});

test("unknown profile throws (loadConfig)", () => {
  assert.throws(() => loadConfig("nope-profile"), /unknown profile/i);
});

test("unknown profile throws (route)", () => {
  assert.throws(() => route({ category: "code" }, { profile: "nope-profile" }), /unknown profile/i);
});

test("purity: routing the same deterministic task twice is deep-equal", () => {
  const task = { id: "t-code", category: "code", prompt: "write a fn" };
  const a = route(task, { profile: PROFILE });
  const b = route(task, { profile: PROFILE });
  assert.deepEqual(a, b);
  assert.notEqual(a, b, "should be a fresh object each call, not a shared reference");
});

test("onJudgment is NOT called on the deterministic path", () => {
  let calls = 0;
  route({ category: "code" }, { profile: PROFILE, onJudgment: () => { calls += 1; } });
  assert.equal(calls, 0);
});

test("logJudgment appends one valid JSON line with the right fields", () => {
  const logPath = resolve(tmpdir(), `router-judgment-test-${process.pid}.jsonl`);
  try {
    const rec = { taskId: "t-42", category: "quux", estimatedTokens: JUDGMENT_ESTIMATED_TOKENS };
    const written = logJudgment(rec, { logPath });

    const contents = readFileSync(logPath, "utf8");
    const lines = contents.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1, "exactly one line expected");

    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.taskId, "t-42");
    assert.equal(parsed.category, "quux");
    assert.equal(parsed.estimatedTokens, JUDGMENT_ESTIMATED_TOKENS);
    assert.equal(typeof parsed.ts, "string");
    assert.ok(!Number.isNaN(Date.parse(parsed.ts)), "ts must be a valid ISO timestamp");
    assert.deepEqual(parsed, written, "returned record must match what was written");
  } finally {
    rmSync(logPath, { force: true });
  }
});
