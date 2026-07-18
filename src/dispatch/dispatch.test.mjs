import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaude, parseCodex, redactSecrets, createProcessDispatcher } from "./dispatch.mjs";

test("parseClaude normalizes result and cache usage", () => {
  const out = parseClaude(JSON.stringify({ result: "ok", usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 4 } }));
  assert.equal(out.result.text, "ok");
  assert.equal(out.usage.tokens.total, 12);
  assert.equal(out.usage.tokens.cacheRead, 4);
});

test("parseCodex selects the last completed agent message", () => {
  const raw = [
    { type: "item.completed", item: { type: "agent_message", text: "first" } },
    { type: "item.completed", item: { type: "agent_message", text: "final" } },
  ].map(JSON.stringify).join("\n");
  assert.equal(parseCodex(raw).result.text, "final");
});

test("parseClaude throws a sanitized error (not a raw SyntaxError) on non-JSON output", () => {
  assert.throws(() => parseClaude("update available!\n{ not json"), /output was not valid JSON/);
});

test("redactSecrets scrubs key/token shapes", () => {
  const dirty = "boom OPENAI_API_KEY=sk-abcd1234efgh5678 Authorization: Bearer abcdef123456 done";
  const clean = redactSecrets(dirty);
  assert.doesNotMatch(clean, /sk-abcd1234/, "raw key value is gone");
  assert.doesNotMatch(clean, /abcdef123456/, "raw bearer token is gone");
  assert.match(clean, /API_KEY=\*\*\*/, "key=value is masked");
  assert.match(clean, /Bearer \*\*\*/, "bearer token is masked");
  // A bare sk- token with no key= prefix is still masked on its own.
  assert.match(redactSecrets("token sk-zzzz9999yyyy"), /sk-\*\*\*/);
});

test("dispatcher rejects an unsafe model alias (no flag injection via a '-'-prefixed model)", async () => {
  const dispatch = createProcessDispatcher({ root: process.cwd() });
  await assert.rejects(
    () => dispatch({ plane: "workhorse", model: "--sandbox=danger" }),
    /unsafe model alias/,
  );
  await assert.rejects(
    () => dispatch({ plane: "frontier", model: "-evil" }),
    /unsafe model alias/,
  );
});

test("workhorse dispatcher sends the pinned provider model and recovers exact Pi usage", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push({ command, args });
    if (command === process.execPath) {
      return { stdout: JSON.stringify({ in: 10, out: 5, reasoning: 2, cacheRead: 3, total: 15 }), startedAt: 2, latencyMs: 1 };
    }
    return { stdout: "answer", startedAt: 1, latencyMs: 20 };
  };
  const dispatch = createProcessDispatcher({ root: process.cwd(), runner, piScript: "fake-pi" });
  const out = await dispatch({ plane: "workhorse", model: "test/kimi-k2.5", modelAlias: "kimi-k2.5-ikey", prompt: "task" });
  assert.deepEqual(calls[0].args.slice(0, 2), ["--model", "test/kimi-k2.5"]);
  assert.equal(out.result.text, "answer");
  assert.equal(out.usage.tokens.total, 15);
  assert.equal(out.usage.tokens.reasoning, 2);
  assert.ok(out.usage.costUsd > 0, "calibrated workhorse cost is reported");
  assert.equal(out.usage.costEstimated, true);
});
