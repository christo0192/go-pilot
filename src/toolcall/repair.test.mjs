import { test } from "node:test";
import assert from "node:assert/strict";
import { validateToolCall, buildRepairPrompt, runRepairLoop } from "./repair.mjs";

// A representative tool schema reused across cases.
const searchSchema = {
  required: ["query"],
  properties: {
    query: { type: "string" },
    limit: { type: "number" },
    verbose: { type: "boolean" },
  },
};

// ---------------------------------------------------------------------------
// validateToolCall
// ---------------------------------------------------------------------------

test("validateToolCall: a valid call is ok with no errors", () => {
  const call = { name: "search", arguments: { query: "hello", limit: 5 } };
  const out = validateToolCall(call, searchSchema);
  assert.equal(out.ok, true);
  assert.deepEqual(out.errors, []);
});

test("validateToolCall: missing required field is named in an error", () => {
  const call = { name: "search", arguments: { limit: 5 } };
  const out = validateToolCall(call, searchSchema);
  assert.equal(out.ok, false);
  assert.ok(
    out.errors.some((e) => e.includes("query") && /required/i.test(e)),
    `expected a missing-required error naming "query", got ${JSON.stringify(out.errors)}`,
  );
});

test("validateToolCall: wrong type is reported with expected and actual", () => {
  const call = { name: "search", arguments: { query: 123 } };
  const out = validateToolCall(call, searchSchema);
  assert.equal(out.ok, false);
  assert.ok(
    out.errors.some((e) => e.includes("query") && e.includes("string") && e.includes("number")),
    `expected a type error for "query", got ${JSON.stringify(out.errors)}`,
  );
});

test("validateToolCall: multiple errors aggregate", () => {
  // query missing (required) AND limit wrong type.
  const call = { name: "search", arguments: { limit: "lots" } };
  const out = validateToolCall(call, searchSchema);
  assert.equal(out.ok, false);
  assert.ok(out.errors.length >= 2, `expected >=2 errors, got ${JSON.stringify(out.errors)}`);
  assert.ok(out.errors.some((e) => e.includes("query")));
  assert.ok(out.errors.some((e) => e.includes("limit")));
});

test("validateToolCall: array vs object types are distinguished", () => {
  const schema = { properties: { items: { type: "array" }, opts: { type: "object" } } };
  const good = validateToolCall({ name: "t", arguments: { items: [1], opts: {} } }, schema);
  assert.equal(good.ok, true);
  // An object passed where an array is required must fail.
  const bad = validateToolCall({ name: "t", arguments: { items: {} } }, schema);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes("items") && e.includes("array") && e.includes("object")));
});

test("validateToolCall: NaN is not accepted as a number", () => {
  const schema = { properties: { n: { type: "number" } } };
  const out = validateToolCall({ name: "t", arguments: { n: NaN } }, schema);
  assert.equal(out.ok, false);
});

test("validateToolCall: unknown fields flagged only when additionalProperties:false", () => {
  const strict = { required: ["query"], properties: { query: { type: "string" } }, additionalProperties: false };
  const withExtra = validateToolCall({ name: "s", arguments: { query: "x", rogue: 1 } }, strict);
  assert.equal(withExtra.ok, false);
  assert.ok(withExtra.errors.some((e) => e.includes("rogue") && /unknown/i.test(e)));

  // Same call passes when additionalProperties is not forbidden.
  const lenient = { required: ["query"], properties: { query: { type: "string" } } };
  const ok = validateToolCall({ name: "s", arguments: { query: "x", rogue: 1 } }, lenient);
  assert.equal(ok.ok, true);
});

test("validateToolCall: malformed envelope (non-object arguments) is rejected", () => {
  const out = validateToolCall({ name: "s", arguments: "not-an-object" }, searchSchema);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("arguments")));
});

test("validateToolCall: missing name is reported", () => {
  const out = validateToolCall({ arguments: { query: "x" } }, searchSchema);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.includes("name")));
});

// ---------------------------------------------------------------------------
// buildRepairPrompt
// ---------------------------------------------------------------------------

test("buildRepairPrompt: contains the tool name and every specific error", () => {
  const call = { name: "search", arguments: { limit: "lots" } };
  const errors = ['Missing required field "query".', 'Field "limit" must be of type number, got string.'];
  const prompt = buildRepairPrompt(call, errors);
  assert.ok(prompt.includes("search"), "prompt should name the tool");
  for (const e of errors) {
    assert.ok(prompt.includes(e), `prompt should include error: ${e}`);
  }
});

// ---------------------------------------------------------------------------
// runRepairLoop  (fake, injected reCall — no model)
// ---------------------------------------------------------------------------

test("runRepairLoop (a): valid first try → ok, attempts=1, reCall NOT called", async () => {
  let reCallCount = 0;
  const reCall = async () => {
    reCallCount += 1;
    return { name: "search", arguments: { query: "x" } };
  };
  const call = { name: "search", arguments: { query: "hello" } };
  const out = await runRepairLoop({ call, schema: searchSchema, reCall, maxRetries: 2 });
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 1);
  assert.equal(reCallCount, 0, "reCall must not be invoked on a first-try pass");
});

test("runRepairLoop (b): invalid then fixed on retry → ok, attempts=2", async () => {
  let reCallCount = 0;
  const reCall = async (prompt) => {
    reCallCount += 1;
    assert.ok(prompt.includes("query"), "repair prompt should mention the missing field");
    return { name: "search", arguments: { query: "recovered" } }; // fixed
  };
  const bad = { name: "search", arguments: {} }; // missing required query
  const out = await runRepairLoop({ call: bad, schema: searchSchema, reCall, maxRetries: 2 });
  assert.equal(out.ok, true);
  assert.equal(out.attempts, 2);
  assert.equal(reCallCount, 1);
  assert.deepEqual(out.call.arguments, { query: "recovered" });
});

test("runRepairLoop (c): invalid through all retries → ok:false, attempts=maxRetries+1, errors present", async () => {
  let reCallCount = 0;
  const reCall = async () => {
    reCallCount += 1;
    return { name: "search", arguments: {} }; // stays invalid every time
  };
  const bad = { name: "search", arguments: {} };
  const out = await runRepairLoop({ call: bad, schema: searchSchema, reCall, maxRetries: 2 });
  assert.equal(out.ok, false);
  assert.equal(out.attempts, 3); // 1 initial + 2 retries
  assert.equal(reCallCount, 2);
  assert.ok(out.errors.length > 0);
  assert.ok(out.errors.some((e) => e.includes("query")));
});

test("runRepairLoop (d): reCall is only invoked on invalid calls", async () => {
  // Two sub-cases prove the invariant from both directions.
  let calls = 0;
  const countingReCall = async () => {
    calls += 1;
    return { name: "search", arguments: { query: "ok" } };
  };

  // Valid input → 0 reCalls.
  await runRepairLoop({
    call: { name: "search", arguments: { query: "ok" } },
    schema: searchSchema,
    reCall: countingReCall,
    maxRetries: 2,
  });
  assert.equal(calls, 0);

  // Invalid input, fixed by first reCall → exactly 1 reCall.
  calls = 0;
  await runRepairLoop({
    call: { name: "search", arguments: {} },
    schema: searchSchema,
    reCall: countingReCall,
    maxRetries: 2,
  });
  assert.equal(calls, 1);
});

test("runRepairLoop: maxRetries=0 does not call reCall and fails fast", async () => {
  let calls = 0;
  const reCall = async () => {
    calls += 1;
    return { name: "search", arguments: { query: "x" } };
  };
  const out = await runRepairLoop({ call: { name: "search", arguments: {} }, schema: searchSchema, reCall, maxRetries: 0 });
  assert.equal(out.ok, false);
  assert.equal(out.attempts, 1);
  assert.equal(calls, 0);
});

test("runRepairLoop: throws if reCall is not a function", async () => {
  await assert.rejects(
    () => runRepairLoop({ call: { name: "s", arguments: {} }, schema: searchSchema, reCall: null }),
    /reCall/,
  );
});
