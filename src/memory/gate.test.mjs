import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mustPass,
  gateThenCompress,
  testsPass,
  scopeMatch,
  noPlaceholders,
} from "./gate.mjs";

test("all checks pass -> gateThenCompress summarizes and calls compressFn", () => {
  const result = { text: "clean work product", files: ["a.mjs"] };

  let calls = 0;
  const compressFn = (r) => {
    calls += 1;
    return { summary: `compressed:${r.text}` };
  };

  const checks = [
    { name: "always-ok", run: () => true },
    { name: "ok-with-shape", run: () => ({ ok: true }) },
  ];

  const out = gateThenCompress(result, checks, compressFn);

  assert.equal(out.summarized, true);
  assert.equal(out.passed, true);
  assert.deepEqual(out.failures, []);
  assert.equal(calls, 1, "compressFn WAS called exactly once");
  assert.deepEqual(out.output, compressFn(result)); // === the compressed shape
});

test("CORE: a failing check passes the FULL result through UNSUMMARIZED and never calls compressFn", () => {
  const result = { text: "broken work", files: ["a.mjs", "b.mjs"], meta: { n: 1 } };

  let calls = 0;
  const compressFn = () => {
    calls += 1;
    return { summary: "should never happen" };
  };

  const checks = [
    { name: "ok-check", run: () => true },
    { name: "failing-check", run: () => ({ ok: false, detail: "did not converge" }) },
  ];

  const out = gateThenCompress(result, checks, compressFn);

  assert.equal(out.summarized, false);
  assert.equal(out.passed, false);
  // The full, untouched original result is the output.
  assert.deepEqual(out.output, result);
  assert.equal(out.output, result, "same reference — not copied or smoothed");
  // The failing check is named.
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0].name, "failing-check");
  assert.equal(out.failures[0].detail, "did not converge");
  // The compressor was NEVER invoked.
  assert.equal(calls, 0, "compressFn MUST NOT be called on failure");
});

test("a check whose run throws is treated as a failure with the error message in detail", () => {
  const result = { text: "x" };
  const checks = [
    {
      name: "throwing-check",
      run: () => {
        throw new Error("boom: lint crashed");
      },
    },
  ];

  const { passed, failures } = mustPass(result, checks);

  assert.equal(passed, false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, "throwing-check");
  assert.equal(failures[0].detail, "boom: lint crashed");
});

test("mustPass aggregates multiple failures", () => {
  const checks = [
    { name: "ok", run: () => true },
    { name: "fail-a", run: () => ({ ok: false, detail: "a-detail" }) },
    { name: "fail-b", run: () => false },
    {
      name: "fail-c-throws",
      run: () => {
        throw new Error("c-detail");
      },
    },
  ];

  const { passed, failures } = mustPass({}, checks);

  assert.equal(passed, false);
  assert.deepEqual(
    failures.map((f) => f.name),
    ["fail-a", "fail-b", "fail-c-throws"],
  );
  assert.equal(failures[0].detail, "a-detail");
  assert.equal(failures[1].detail, undefined);
  assert.equal(failures[2].detail, "c-detail");
});

test("scopeMatch: passes when files are in scope, fails when a file escapes scope", () => {
  const allowed = ["src/a.mjs", "src/b.mjs"];

  const passResult = { files: ["src/a.mjs"] };
  assert.equal(mustPass(passResult, [scopeMatch(allowed)]).passed, true);

  const failResult = { files: ["src/a.mjs", "src/secret.mjs"] };
  const { passed, failures } = mustPass(failResult, [scopeMatch(allowed)]);
  assert.equal(passed, false);
  assert.equal(failures[0].name, "scopeMatch");
  assert.match(failures[0].detail, /secret\.mjs/);
});

test("noPlaceholders: passes on clean text, fails on TODO / ellipsis markers", () => {
  const clean = { text: "the function returns a normalized shape" };
  assert.equal(mustPass(clean, [noPlaceholders()]).passed, true);

  const dirty = { text: "handle the edge case // TODO wire this up" };
  const { passed, failures } = mustPass(dirty, [noPlaceholders()]);
  assert.equal(passed, false);
  assert.equal(failures[0].name, "noPlaceholders");
  assert.match(failures[0].detail, /placeholder/i);
});

test("testsPass factory adapts a plain boolean function into a check", () => {
  const okCheck = testsPass((r) => r.exit === 0, "suite-green");
  const badCheck = testsPass((r) => r.exit === 0, "suite-green");

  assert.equal(mustPass({ exit: 0 }, [okCheck]).passed, true);

  const failed = mustPass({ exit: 1 }, [badCheck]);
  assert.equal(failed.passed, false);
  assert.equal(failed.failures[0].name, "suite-green");
});
