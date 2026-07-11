import { test } from "node:test";
import assert from "node:assert/strict";
import { guardBoundary, DEFAULT_THRESHOLD, estimateTokens } from "./guard.mjs";

// Budgets are in ESTIMATED TOKENS (~4 chars/token). "over budget" fixtures must
// therefore exceed DEFAULT_THRESHOLD * 4 characters.
const overBudget = (tokens = DEFAULT_THRESHOLD + 200) => "x".repeat(tokens * 4);

test("DEFAULT_THRESHOLD is 800 (tokens)", () => {
  assert.equal(DEFAULT_THRESHOLD, 800);
});

test("estimateTokens is ~chars/4, monotonic, 0 for empty", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(400)), 100);
  assert.ok(estimateTokens("a".repeat(1000)) > estimateTokens("a".repeat(999)) - 1);
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
  const content = overBudget(); // well over budget
  const out = guardBoundary({ tier: "full", content, justification: "user asked for raw log" });
  assert.equal(out.tier, "full");
  assert.equal(out.flagged, false);
  assert.equal(out.reason, "justified");
  assert.equal(out.content, content);
});

test("full, no justification, over budget, WITH ref → downgraded to reference, flagged", () => {
  const content = overBudget();
  const ref = "mem://doc/big";
  const out = guardBoundary({ tier: "full", content, ref });
  assert.equal(out.tier, "reference");
  assert.equal(out.flagged, true);
  assert.equal(out.ref, ref);
  assert.equal(out.reason, "downgraded: unjustified full content over threshold, ref available");
});

test("full, no justification, over budget, NO ref → compressed, flagged, shorter, artifact preserved", () => {
  const content = overBudget();
  const out = guardBoundary({ tier: "full", content });
  assert.equal(out.tier, "compressed");
  assert.equal(out.flagged, true);
  assert.ok(out.content.length < content.length, "truncated content is shorter than input");
  assert.match(out.content, /elided/, "carries an elision marker");
  assert.match(out.content, /full output → artifact:\/\/sha256:/, "points at the full artifact");
  // The full output is preserved verbatim as an addressable artifact.
  assert.equal(out.artifact.content, content, "artifact carries the full untruncated output");
  assert.equal(out.artifact.id, out.ref, "the ref addresses the artifact");
  assert.equal(out.artifact.tokens, estimateTokens(content));
});

test("token budget: content within budget passes even when char-long", () => {
  // 3000 chars ≈ 750 tokens — under the 800-token default, so NOT downgraded
  // (this is exactly what the char→token switch changes).
  const content = "a".repeat(3000);
  const out = guardBoundary({ tier: "full", content });
  assert.equal(out.tier, "full");
  assert.equal(out.flagged, false);
  assert.equal(out.reason, "under threshold");
});

test("full, no justification, at/under budget → tier full, not flagged", () => {
  const content = "a".repeat(DEFAULT_THRESHOLD * 4); // exactly at the token budget
  const out = guardBoundary({ tier: "full", content });
  assert.equal(out.tier, "full");
  assert.equal(out.flagged, false);
  assert.equal(out.reason, "under threshold");
  assert.equal(out.content, content);
});

test("opts.threshold overrides DEFAULT_THRESHOLD (in tokens)", () => {
  const content = "b".repeat(200); // 50 tokens
  // Under default (800) would pass; with a 10-token budget it downgrades.
  const out = guardBoundary({ tier: "full", content }, { threshold: 10 });
  assert.equal(out.tier, "compressed");
  assert.equal(out.flagged, true);
});

test("structured truncation preserves the failure signal (command, exit code, failing test, file:line)", () => {
  const filler = Array.from({ length: 400 }, (_, i) => `ok ${i + 1} - some passing assertion number ${i + 1}`);
  const log = [
    "$ npm test",
    "> go-pilot@0.0.0 test",
    "> node --test",
    ...filler.slice(0, 200),
    "not ok 201 - dark mode toggle persists across reload",
    "  AssertionError [ERR_ASSERTION]: expected true to equal false",
    "  at Object.<anonymous> (src/theme/toggle.test.mjs:88:10)",
    ...filler.slice(200),
    "# tests 401",
    "# pass 400",
    "# fail 1",
    "npm ERR! Test failed.  exit code 1",
  ].join("\n");

  const out = guardBoundary({ tier: "full", content: log }, { threshold: 120 });
  assert.equal(out.tier, "compressed");
  assert.equal(out.flagged, true);
  assert.ok(out.content.length < log.length, "output is shorter than the raw log");

  // The actionable failure signal survives even though it sits in the middle.
  assert.match(out.content, /not ok 201 - dark mode toggle/, "failing test line preserved");
  assert.match(out.content, /toggle\.test\.mjs:88:10/, "file:line preserved");
  assert.match(out.content, /exit code 1/, "exit code preserved");
  assert.match(out.content, /\$ npm test/, "the command line preserved (head)");
  assert.match(out.content, /elided/, "middle is elided with a marker");
  assert.equal(out.artifact.content, log);
});

test("structured truncation is head-AND-tail: both ends survive", () => {
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i} plain content with no signal words here`);
  const content = lines.join("\n");
  const out = guardBoundary({ tier: "full", content }, { threshold: 80 });
  assert.equal(out.tier, "compressed");
  assert.match(out.content, /line 0 /, "head survives");
  assert.match(out.content, /line 299 /, "tail survives");
  assert.match(out.content, /elided/, "the middle is elided");
});

test("single over-budget line still keeps head+tail (never dropped entirely)", () => {
  const content = "q".repeat(20000); // one giant line, no newlines
  const out = guardBoundary({ tier: "full", content }, { threshold: 100 });
  assert.equal(out.tier, "compressed");
  assert.ok(out.content.length < content.length);
  assert.match(out.content, /^q+/, "keeps a head slice");
  assert.match(out.content, /elided/);
  assert.equal(out.artifact.content, content);
});

test("truncation never emits more than the raw input (many scattered short signals)", () => {
  // Marker/ref overhead could otherwise balloon a tiny, signal-dense input past
  // its original size — which would defeat the whole point of the boundary.
  const content = ["FAIL", "", "", "", "", "FAIL", "", "", "", ""].join("\n");
  const out = guardBoundary({ tier: "full", content }, { threshold: 4 });
  assert.equal(out.tier, "compressed");
  assert.equal(out.flagged, true);
  assert.ok(
    out.content.length <= content.length,
    `compressed output (${out.content.length}) must not exceed raw input (${content.length})`,
  );
});

test("signal detection catches lowercase 'failed' and ✕ glyph test markers", () => {
  const filler = Array.from({ length: 200 }, (_, i) => `ok ${i} passing assertion`).join("\n");
  const content = [
    "$ npm test",
    filler,
    "✕ dark mode toggle (5 ms)",
    filler,
    "1) checkout flow failed",
    "done",
  ].join("\n");
  const out = guardBoundary({ tier: "full", content }, { threshold: 100 });
  assert.equal(out.tier, "compressed");
  assert.match(out.content, /✕ dark mode toggle/, "glyph failure marker preserved");
  assert.match(out.content, /checkout flow failed/, "lowercase 'failed' preserved");
});

test("artifact id is deterministic for equal content (pure)", () => {
  const content = overBudget();
  const a = guardBoundary({ tier: "full", content });
  const b = guardBoundary({ tier: "full", content });
  assert.equal(a.ref, b.ref, "same content → same artifact id");
});

test("ACCEPTANCE: over-budget unjustified full is never silently passed", () => {
  const content = overBudget();
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
