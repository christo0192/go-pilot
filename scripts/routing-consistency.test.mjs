import { test } from "node:test";
import assert from "node:assert/strict";
import { consistencyErrors, loadInputs, renderProductionRouting } from "./routing-consistency.mjs";

test("production routing and operational aliases are consistent", () => {
  const inputs = loadInputs();
  assert.deepEqual(consistencyErrors(inputs), []);
  const markdown = renderProductionRouting(inputs);
  assert.match(markdown, /extract \| workhorse \| kimi-k2\.5-ikey/);
  assert.match(markdown, /test\/deepseek-v4-pro/);
});
