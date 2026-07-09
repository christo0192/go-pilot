import { test } from "node:test";
import assert from "node:assert/strict";
import { guardBoundary, DEFAULT_THRESHOLD } from "./guard.mjs";

test("DEFAULT_THRESHOLD is 800", () => {
  assert.equal(DEFAULT_THRESHOLD, 800);
});

test("reference passes through unchanged (ref preserved, not flagged)", () => {
  const ref = { uri: "mem://doc/42", span: [0, 100] };
  const out = guardBoundary({ tier: "reference", ref });
  assert.deepEqual(out, {
    tier: "reference",
    ref,
    flagged: false,
    reason: "reference passes",
  });
  assert.equal(out.ref, ref);
});

test("compressed passes through (not flagged)", () => {
  const out = guardBoundary({ tier: "compressed", content: "short summary" });
  assert.deepEqual(out, {
    tier: "compressed",
    content: "short summary",
    flagged: false,
    reason: "compressed passes",
  });
});

test("full + non-empty justification → tier full, not flagged", () => {
  const content = "x".repeat(5000); // well over threshold
  const out = guardBoundary({ tier: "full", content, justification: "user asked for raw log" });
  assert.equal(out.tier, "full");
  assert.equal(out.flagged, false);
  assert.equal(out.reason, "justified");
  assert.equal(out.content, content);
});

test("full, no justification, over threshold, WITH ref → downgraded to reference, flagged", () => {
  const content = "y".repeat(2000);
  const ref = "mem://doc/big";
  const out = guardBoundary({ tier: "full", content, ref });
  assert.equal(out.tier, "reference");
  assert.equal(out.flagged, true);
  assert.equal(out.ref, ref);
  assert.equal(out.reason, "downgraded: unjustified full content over threshold, ref available");
});

test("full, no justification, over threshold, NO ref → compressed, flagged, shorter, has marker", () => {
  const content = "z".repeat(4000);
  const out = guardBoundary({ tier: "full", content });
  assert.equal(out.tier, "compressed");
  assert.equal(out.flagged, true);
  assert.ok(out.content.length < content.length, "truncated content is shorter than input");
  assert.match(out.content, /…\[\+\d+ chars elided\]$/);
  assert.equal(out.reason, "downgraded: unjustified full content, no ref — truncated");
});

test("full, no justification, at/under threshold → tier full, not flagged", () => {
  const content = "a".repeat(DEFAULT_THRESHOLD); // exactly at threshold
  const out = guardBoundary({ tier: "full", content });
  assert.equal(out.tier, "full");
  assert.equal(out.flagged, false);
  assert.equal(out.reason, "under threshold");
  assert.equal(out.content, content);
});

test("opts.threshold overrides DEFAULT_THRESHOLD", () => {
  const content = "b".repeat(50);
  // Under default (800) would pass; with threshold 10 and no ref it downgrades.
  const out = guardBoundary({ tier: "full", content }, { threshold: 10 });
  assert.equal(out.tier, "compressed");
  assert.equal(out.flagged, true);
});

test("ACCEPTANCE: over-threshold unjustified full is never silently passed", () => {
  const content = "c".repeat(3000);
  // With ref
  const withRef = guardBoundary({ tier: "full", content, ref: "r://x" });
  assert.ok(withRef.tier !== "full" || withRef.flagged === true);
  // Without ref
  const noRef = guardBoundary({ tier: "full", content });
  assert.ok(noRef.tier !== "full" || noRef.flagged === true);
});

test("unknown tier throws", () => {
  assert.throws(() => guardBoundary({ tier: "raw", content: "hi" }), /unknown tier/);
});

test("missing tier throws", () => {
  assert.throws(() => guardBoundary({ content: "hi" }), /missing tier/);
});

test("full tier without string content throws", () => {
  assert.throws(() => guardBoundary({ tier: "full" }), /requires a string/);
});
