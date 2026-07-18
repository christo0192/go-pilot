import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTask } from "./run.mjs";
import { createMockMem0 } from "../memory/mem0-adapter.mjs";
import { piToolArgs, loadToolProfiles } from "../router/tool-profiles.mjs";
import { noPlaceholders } from "../memory/gate.mjs";
import { createCircuitBreaker } from "../reliability/retry.mjs";

// Isolated, non-git temp cwd so retrieval, rule discovery, and workspace capture
// never touch the real repo — keeps the lifecycle test hermetic and fast.
const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
function tmpCwd() {
  const d = mkdtempSync(join(tmpdir(), "gopilot-run-"));
  tmpDirs.push(d);
  return d;
}
// A deterministic retrieval stand-in — big enough to force the context boundary
// to compress at the tiny budget below, with no dependency on rg or repo files.
function fakeRetriever(text) {
  return () => ({ text, files: [{ file: "src/theme/toggle.mjs" }], tokens: 999 });
}

// ---------------------------------------------------------------------------
// Hermetic fakes: NO sockets, NO network, NO CLIs. A fake dispatcher, a spy
// wrapper over the deterministic in-memory Mem0 mock, spy checks, and a spy
// metrics recorder — enough to prove EACH lifecycle stage was reached.
// ---------------------------------------------------------------------------

/** Spy adapter: real deterministic mock underneath, call counters on top. */
function makeSpyAdapter() {
  const inner = createMockMem0();
  const calls = { add: 0, search: 0 };
  return {
    calls,
    inner,
    add(memory) {
      calls.add += 1;
      return inner.add(memory);
    },
    search(query, topK) {
      calls.search += 1;
      return inner.search(query, topK);
    },
  };
}

test("full lifecycle fires: route -> tools -> recall -> boundary -> dispatch -> validate -> promote -> metrics", async () => {
  const adapter = makeSpyAdapter();
  // Seed Tier-2 so recall returns a hit for the task context.
  adapter.add({ text: "dark mode toggle uses css variables", kind: "decision" });
  const seedSearchBaseline = adapter.calls.search; // adds don't touch search

  let checkCalls = 0;
  const spyCheck = {
    name: "spy-check",
    run() {
      checkCalls += 1;
      return true;
    },
  };

  const dispatchCalls = [];
  const dispatch = (args) => {
    dispatchCalls.push(args);
    return {
      result: { text: "implemented the dark mode toggle cleanly" },
      usage: {
        tokens: { single: 1000, multi: 700 },
        quality: { single: 9, multi: 9 },
        retries: { count: 0, attempts: 1 },
      },
    };
  };

  const metricRecords = [];
  const metrics = (record) => {
    metricRecords.push(record);
    return { recorded: true, record };
  };

  const res = await runTask(
    {
      id: "t-1",
      category: "code",
      prompt: "add a dark mode toggle",
      context: "dark mode toggle",
      checks: [spyCheck],
      memory: { text: "dark mode toggle shipped", kind: "decision" },
    },
    {
      profile: "pure-anthropic",
      dispatch,
      adapter,
      metrics,
      cwd: tmpCwd(),
      rules: false, // don't scan the real repo for instruction files
      retriever: fakeRetriever("theme toggle context ".repeat(60)),
      breaker: createCircuitBreaker(), // fresh breaker — no shared module state
      boundaryThreshold: 200, // reserve the task, then force retrieved context over the remainder
    },
  );

  // 4. ROUTE was chosen (pure-anthropic: code -> frontier/sonnet).
  assert.equal(res.plan.plane, "frontier");
  assert.equal(res.plan.model, "sonnet");
  assert.equal(res.plan.category, "code");
  // 4b. The resolved provider + pinned version are recorded (8.13 follow-on).
  assert.equal(res.plan.provider, "anthropic-subscription");
  assert.equal(typeof res.plan.version, "string");

  // 5. TOOL PROFILE was set from the category.
  const expectedTools = piToolArgs("code", { profiles: loadToolProfiles() });
  assert.deepEqual(res.plan.tools, expectedTools);

  // 6. RECALL ran (adapter.search invoked) and produced an injection.
  assert.ok(adapter.calls.search > seedSearchBaseline, "recall queried the adapter");
  assert.ok(res.recall.tokens > 0, "recall produced a non-empty context");

  // 7. BOUNDARY was applied to the crossing content (threshold 10 -> downgrade).
  assert.equal(res.plan.contextTier, "compressed");
  assert.equal(res.boundary.flagged, true);

  // 8. DISPATCH was called exactly once with the routed plane/model/tools/prompt.
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0].plane, "frontier");
  assert.equal(dispatchCalls[0].model, "sonnet");
  assert.deepEqual(dispatchCalls[0].tools, expectedTools);
  assert.equal(dispatchCalls[0].category, "code");
  // The complete prompt is budgeted as one boundary. At this deliberately tiny
  // budget it retains the task tail and preserves the full prompt as an artifact.
  assert.ok(dispatchCalls[0].prompt.length > 0, "dispatcher receives a bounded prompt");
  assert.ok(res.boundary.artifact, "full prompt is preserved as an artifact");
  assert.equal(res.dispatched, true);

  // 9. VALIDATION ran (spy check invoked) and passed.
  assert.ok(checkCalls > 0, "validation gate ran the check");
  assert.equal(res.validated, true);

  // 10. PROMOTION happened for the keeper and landed in Tier-2.
  assert.equal(res.promoted, true);
  const hits = adapter.inner.search("dark mode toggle shipped");
  assert.ok(hits.some((h) => h.memory.text === "dark mode toggle shipped"), "keeper persisted");

  // 11. METRICS were recorded (spy recorder invoked with a valid record).
  assert.equal(metricRecords.length, 1);
  assert.equal(metricRecords[0].tokens.multi, 700);
  assert.equal(metricRecords[0].routerOverheadTokens, 0);
  assert.deepEqual(res.metrics, { recorded: true, record: metricRecords[0] });

  assert.equal(res.verdict, "ok");
});

test("dry-run returns the plan, invokes NO dispatch, verdict 'dry-run'", async () => {
  let dispatchCount = 0;
  const dispatch = () => {
    dispatchCount += 1;
    return { result: {}, usage: {} };
  };

  const res = await runTask(
    { category: "code", prompt: "add a dark mode toggle" },
    { profile: "pure-anthropic", dryRun: true, dispatch },
  );

  assert.equal(dispatchCount, 0, "dispatch must NOT be called on dry-run");
  assert.equal(res.dispatched, false);
  assert.equal(res.verdict, "dry-run");
  assert.equal(res.metrics, null);

  // The plan is still fully populated.
  assert.equal(res.plan.plane, "frontier");
  assert.equal(res.plan.model, "sonnet");
  assert.equal(res.plan.category, "code");
  assert.deepEqual(res.plan.tools, piToolArgs("code", { profiles: loadToolProfiles() }));
  assert.equal(typeof res.plan.contextTier, "string");
  assert.equal(res.plan.signedOff, false);
});

test("prose extraction does not require JSON when no structured format was requested", async () => {
  const res = await runTask(
    { category: "extract", prompt: "Extract and summarize the main obligations." },
    {
      profile: "ikey-prod",
      dispatch: () => ({ result: { text: "The supplier must deliver by Friday." }, usage: {} }),
      retrieve: false, rules: false, captureWorkspace: false,
    },
  );
  assert.equal(res.validated, true);
  assert.equal(res.fallbackAttempted, false);
});

test("a transiently failed K2.5 dispatch falls back to pinned DeepSeek and counts fallback usage", async () => {
  const calls = [];
  const res = await runTask(
    { category: "extract", prompt: "Return JSON with a name.", outputFormat: "json" },
    {
      profile: "ikey-prod",
      dispatch: (req) => {
        calls.push(req);
        if (req.modelAlias === "kimi-k2.5-ikey") throw new Error("ETIMEDOUT upstream");
        return { result: { text: '{"name":"Ada"}' }, usage: { tokens: { input: 10, output: 5, total: 15 }, costUsd: 0.002 } };
      },
      contract: { maxRetries: 0 }, retrieve: false, rules: false, captureWorkspace: false,
    },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].modelAlias, "kimi-k2.5-ikey");
  assert.equal(calls[1].modelAlias, "deepseek-ikey");
  assert.equal(res.validated, true);
  assert.equal(res.fallbackAttempted, true);
  assert.equal(res.fallbackUsed, true);
  assert.equal(res.usage.tokens.total, 15);
});

test("fallback accounting sums tokens without applying the per-answer cap to both attempts", async () => {
  let calls = 0;
  const res = await runTask(
    { category: "extract", prompt: "Return JSON.", outputFormat: "json" },
    {
      profile: "ikey-prod",
      dispatch: () => {
        calls += 1;
        return calls === 1
          ? { result: { text: "not-json" }, usage: { tokens: { input: 1, output: 6, total: 7 } } }
          : { result: { text: '{"ok":true}' }, usage: { tokens: { input: 1, output: 6, total: 7 } } };
      },
      contract: { maxOutputTokens: 8, requireUsageReport: true },
      retrieve: false, rules: false, captureWorkspace: false,
    },
  );
  assert.equal(res.validated, true);
  assert.equal(res.usage.tokens.output, 12, "aggregate usage includes both attempts");
  assert.equal(res.fallbackUsed, true);
});

test("live doc-QA refuses source-less dispatch because citations cannot be validated", async () => {
  await assert.rejects(
    runTask(
      { category: "doc-qa", prompt: "What is the renewal date?" },
      { profile: "ikey-prod", dispatch: () => assert.fail("must not dispatch"), retrieve: false, rules: false },
    ),
    /requires task\.context/,
  );
});

test("validation failure: a 'TODO' result is NOT promoted and verdict is 'failed'", async () => {
  const adapter = makeSpyAdapter();
  const dispatch = () => ({
    result: { text: "did the thing but TODO finish the edge cases" },
    usage: { tokens: { single: 1000, multi: 950 } },
  });

  const res = await runTask(
    {
      category: "code",
      prompt: "x",
      checks: [noPlaceholders()],
      memory: { text: "would-be keeper", kind: "decision" },
    },
    { profile: "pure-anthropic", dispatch, adapter, captureWorkspace: false },
  );

  assert.equal(res.validated, false);
  assert.equal(res.promoted, false, "a failed result is never promoted");
  assert.equal(res.verdict, "failed");
  assert.ok(res.failures.some((f) => f.name === "noPlaceholders"));
  // Nothing landed in Tier-2.
  assert.equal(adapter.inner.search("would-be keeper").length, 0);
});

test("sign-off gate: requested multi-agent with NO sign-off is forced to single-agent (real downgrade)", async () => {
  const res = await runTask(
    { category: "code", prompt: "x" },
    { profile: "pure-anthropic", dryRun: true, mode: "multi-agent" },
  );

  assert.equal(res.plan.signedOff, false);
  assert.equal(res.plan.execution, "single-agent");
  assert.equal(res.plan.downgraded, true, "multi-agent -> single-agent is a genuine downgrade");
});

test("a plain single-agent run is NOT labeled downgraded", async () => {
  const res = await runTask(
    { category: "code", prompt: "x" },
    { profile: "pure-anthropic", dryRun: true },
  );
  assert.equal(res.plan.execution, "single-agent");
  assert.equal(res.plan.downgraded, false, "nothing was downgraded");
});

test("sign-off gate: a class that MEETS targets is allowed multi-agent", async () => {
  const rec = {
    runId: "r1",
    taskClass: "code",
    tokens: { single: 1000, multi: 700 }, // 30% reduction
    quality: { single: 9, multi: 9 }, // 0% drop
    retries: { count: 0, attempts: 1 },
    routerOverheadTokens: 0,
  };
  const res = await runTask(
    { category: "code", prompt: "x" },
    { profile: "pure-anthropic", dryRun: true, mode: "multi-agent", signoffRecords: { code: [rec, rec] } },
  );

  assert.equal(res.plan.signedOff, true);
  assert.equal(res.plan.execution, "multi-agent");
  assert.equal(res.plan.downgraded, false);
});

test("unknown profile throws a clear error", async () => {
  await assert.rejects(
    () => runTask({ category: "code", prompt: "x" }, { profile: "does-not-exist", dryRun: true }),
    /unknown profile/i,
  );
});

test("live run without an injected dispatcher throws a clear error", async () => {
  await assert.rejects(
    () => runTask({ category: "code", prompt: "x" }, { profile: "pure-anthropic" }),
    /dispatch is required/i,
  );
});

test("missing category fails closed without an injected judgment router", async () => {
  await assert.rejects(
    () => runTask({ prompt: "something ambiguous" }, { profile: "pure-anthropic", dryRun: true }),
    /requires opts\.judgeRoute/,
  );
});

test("candidate-race executes two candidates and selects a passing result", async () => {
  const calls = [];
  const dispatch = ({ role }) => {
    calls.push(role);
    return calls.length === 1
      ? { result: { text: "TODO incomplete" }, usage: {} }
      : { result: { text: "verified result" }, usage: {} };
  };
  const res = await runTask(
    { category: "code", prompt: "implement safely" },
    { profile: "pure-anthropic", mode: "candidate-race", dispatch, retrieve: false, captureWorkspace: false, allowParallelCost: true },
  );
  assert.equal(calls.length, 2);
  assert.equal(res.result.text, "verified result");
  assert.equal(res.verdict, "ok");
});

test("candidate-race survives one candidate erroring (allSettled, not all)", async () => {
  // One candidate's dispatch throws and (with retries off) fails outright; the
  // other returns a passing result. The run must SUCCEED on the survivor rather
  // than abort — the whole point of the redundancy.
  let n = 0;
  const dispatch = () => {
    n += 1;
    if (n === 1) throw new Error("transient provider error");
    return { result: { text: "verified survivor" }, usage: {} };
  };
  const res = await runTask(
    { category: "code", prompt: "x" },
    {
      profile: "pure-anthropic",
      mode: "candidate-race",
      dispatch,
      retrieve: false,
      rules: false,
      shouldRetry: () => false, // no retries, so the first candidate fails outright
      breakers: new Map(), // isolated breaker registry
      captureWorkspace: false,
      allowParallelCost: true,
    },
  );
  assert.equal(res.verdict, "ok");
  assert.equal(res.result.text, "verified survivor");
});

test("candidate-race is NOT sign-off-gated but REQUIRES explicit cost approval on a live run", async () => {
  const dispatch = () => ({ result: { text: "ok" }, usage: {} });
  // No allowParallelCost -> the cost-opt-in guard refuses (never a stray --mode).
  await assert.rejects(
    () => runTask(
      { category: "code", prompt: "x" },
      { profile: "pure-anthropic", mode: "candidate-race", dispatch, retrieve: false, captureWorkspace: false },
    ),
    /requires explicit cost approval/,
  );
  // A dry-run still shows the plan (no spend) without approval.
  const dry = await runTask(
    { category: "code", prompt: "x" },
    { profile: "pure-anthropic", mode: "candidate-race", dryRun: true },
  );
  assert.equal(dry.plan.execution, "candidate-race", "not downgraded by sign-off");
  assert.equal(dry.verdict, "dry-run");
});

test("plan-then-execute performs separate planner and executor calls", async () => {
  const roles = [];
  const dispatch = ({ role }) => {
    roles.push(role);
    return { result: { text: role === "planner" ? "1. inspect\n2. edit\n3. test" : "implemented and tested" }, usage: {} };
  };
  const res = await runTask(
    { category: "orchestrate", prompt: "implement safely" },
    { profile: "pure-anthropic", dispatch, retrieve: false, captureWorkspace: false },
  );
  assert.deepEqual(roles, ["planner", "executor"]);
  assert.equal(res.verdict, "ok");
});

test("ikey-prod extraction dispatches pinned K2.5 then validated DeepSeek fallback", async () => {
  const calls = [];
  const dispatch = ({ model, modelAlias }) => {
    calls.push({ model, modelAlias });
    if (modelAlias === "kimi-k2.5-ikey") {
      return { result: { text: "not json" }, usage: { tokens: { input: 10, output: 4, total: 14 }, costUsd: 0.01 } };
    }
    return { result: { text: '{"name":"Ada"}' }, usage: { tokens: { input: 8, output: 3, total: 11 }, costUsd: 0.002 } };
  };
  const res = await runTask(
    { category: "extract", prompt: "extract name", context: "Name: Ada", schema: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string" } } } },
    { profile: "ikey-prod", dispatch, retrieve: false, rules: false, captureWorkspace: false, contract: { maxRetries: 0 } },
  );
  assert.deepEqual(calls, [
    { model: "test/kimi-k2.5", modelAlias: "kimi-k2.5-ikey" },
    { model: "test/deepseek-v4-pro", modelAlias: "deepseek-ikey" },
  ]);
  assert.equal(res.fallbackUsed, true);
  assert.equal(res.verdict, "ok");
  assert.equal(res.usage.tokens.total, 25);
  assert.equal(res.usage.costUsd, 0.012);
});

test("doc-QA builds an evidence pack and enforces known citations", async () => {
  let dispatchedPrompt = "";
  const dispatch = ({ prompt }) => {
    dispatchedPrompt = prompt;
    return { result: { text: "The limit is 10 users [e1]." }, usage: {} };
  };
  const res = await runTask(
    { category: "doc-qa", prompt: "What is the user limit?", context: "# Limits\nThe account supports 10 users." },
    { profile: "ikey-prod", dispatch, retrieve: false, rules: false, captureWorkspace: false, contract: { maxRetries: 0 } },
  );
  assert.match(dispatchedPrompt, /<evidence>/);
  assert.match(dispatchedPrompt, /\[e1\]/);
  assert.equal(res.verdict, "ok");
  assert.equal(res.fallbackUsed, false);
});
