import { test } from "node:test";
import assert from "node:assert/strict";

import { signoffClass, signoff, formatSignoff } from "./signoff.mjs";

// Build a metrics record with the given class + reduction/drop percentages
// expressed directly via single/multi token & quality pairs.
function record(taskClass, overrides = {}) {
  return {
    runId: `run-${taskClass}`,
    taskClass,
    tokens: { single: 100, multi: 70 }, // 30% reduction by default
    quality: { single: 100, multi: 98 }, // 2% drop by default
    retries: { count: 0, attempts: 1 },
    routerOverheadTokens: 10,
    ...overrides,
  };
}

// --- signoffClass ----------------------------------------------------------

test("strong metrics (30% reduction, 2% drop) => sign-off", () => {
  const res = signoffClass([record("codegen")]);
  assert.equal(res.verdict, "sign-off");
  assert.equal(res.class, "codegen");
  assert.equal(res.metrics.tokenReductionPct, 30);
  assert.equal(res.metrics.qualityDropPct, 2);
});

test("failing token target (15% reduction) => revert, reason names the token target", () => {
  const res = signoffClass([
    record("summarize", { tokens: { single: 100, multi: 85 } }), // 15% < 20%
  ]);
  assert.equal(res.verdict, "revert-to-single");
  assert.match(res.reason, /token reduction/);
  assert.match(res.reason, /target 20%/);
});

test("failing quality target (8% drop) => revert, reason names quality", () => {
  const res = signoffClass([
    record("refactor", { quality: { single: 100, multi: 92 } }), // 8% > 5%
  ]);
  assert.equal(res.verdict, "revert-to-single");
  assert.match(res.reason, /quality drop/);
  assert.match(res.reason, /target 5%/);
});

test("empty records => revert, reason mentions pending/no data", () => {
  const res = signoffClass([], {}, "untested");
  assert.equal(res.verdict, "revert-to-single");
  assert.equal(res.class, "untested");
  assert.match(res.reason, /no data|pending/);
  assert.equal(res.metrics.tokenReductionPct, null);
});

test("boundary: exactly 20% reduction / 5% drop => sign-off (inclusive)", () => {
  const res = signoffClass([
    record("boundary", {
      tokens: { single: 100, multi: 80 }, // exactly 20%
      quality: { single: 100, multi: 95 }, // exactly 5%
    }),
  ]);
  assert.equal(res.verdict, "sign-off");
});

test("aggregation averages reduction/drop across a class's runs", () => {
  const res = signoffClass([
    record("codegen", { tokens: { single: 100, multi: 60 } }), // 40%
    record("codegen", { tokens: { single: 100, multi: 80 } }), // 20%
  ]);
  assert.equal(res.metrics.tokenReductionPct, 30); // avg(40, 20)
  assert.equal(res.verdict, "sign-off");
});

test("targets are overridable via the targets arg", () => {
  // Raise the bar to 35% — a 30%-reduction class now reverts.
  const res = signoffClass([record("codegen")], { tokenReductionPct: 35 });
  assert.equal(res.verdict, "revert-to-single");
  assert.match(res.reason, /target 35%/);
});

// --- signoff (all classes) -------------------------------------------------

test("signoff over a mix returns per-class verdicts and a correct summary", () => {
  const byClass = {
    codegen: [record("codegen")], // strong => sign-off
    summarize: [record("summarize", { tokens: { single: 100, multi: 85 } })], // 15% => revert
    refactor: [record("refactor", { quality: { single: 100, multi: 92 } })], // 8% drop => revert
    untested: [], // no data => revert (D17)
  };

  const out = signoff(byClass);

  // Deterministic, sorted class order.
  assert.deepEqual(
    out.results.map((r) => r.class),
    ["codegen", "refactor", "summarize", "untested"],
  );

  assert.deepEqual(out.signedOff, ["codegen"]);
  assert.deepEqual(out.reverted, ["refactor", "summarize", "untested"]);

  const byName = Object.fromEntries(out.results.map((r) => [r.class, r.verdict]));
  assert.equal(byName.codegen, "sign-off");
  assert.equal(byName.summarize, "revert-to-single");
  assert.equal(byName.refactor, "revert-to-single");
  assert.equal(byName.untested, "revert-to-single");
});

test("signoff accepts the array-of-{class,records} input shape", () => {
  const out = signoff([
    { class: "b", records: [record("b")] },
    { class: "a", records: [] },
  ]);
  assert.deepEqual(
    out.results.map((r) => r.class),
    ["a", "b"],
  ); // sorted
  assert.deepEqual(out.signedOff, ["b"]);
  assert.deepEqual(out.reverted, ["a"]);
});

// --- formatSignoff ---------------------------------------------------------

test("formatSignoff renders a markdown table with the D17 note", () => {
  const out = signoff({ codegen: [record("codegen")], untested: [] });
  const md = formatSignoff(out);
  assert.match(md, /\| class \| reduction% \| drop% \| verdict \|/);
  assert.match(md, /codegen/);
  assert.match(md, /sign-off/);
  assert.match(md, /D17/);
  assert.match(md, /revert-to-single/);
});

test("formatSignoff also accepts a bare results array", () => {
  const out = signoff({ codegen: [record("codegen")] });
  const md = formatSignoff(out.results);
  assert.match(md, /codegen/);
});
