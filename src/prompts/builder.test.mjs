import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "./builder.mjs";

test("buildPrompt keeps a stable cache prefix and dynamic suffix", () => {
  const a = buildPrompt({ policy: "safe", rules: "test", context: "one", task: "a" });
  const b = buildPrompt({ policy: "safe", rules: "test", context: "two", task: "b" });
  assert.equal(a.cache.key, b.cache.key);
  assert.notEqual(a.text, b.text);
  assert.ok(a.tokens > 0);
});
