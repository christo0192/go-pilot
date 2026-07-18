import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sanitize, recoverUsage } from "./pi-usage.mjs";

test("sanitize collapses JSON-escaped newlines/tabs to spaces (not letters)", () => {
  // The 2-char escape sequence \n must become a space, NOT the letter "n".
  assert.equal(sanitize("policy\\n[YAGNI] Build"), "policy YAGNI Build");
  assert.equal(sanitize("a\\tb\\rc"), "a b c");
  // Real newlines are handled by the generic non-alnum pass; sanitize does not
  // trim (callers do), so compare the trimmed form here.
  assert.equal(sanitize("## policy\n[YAGNI]").trim(), "policy YAGNI");
});

test("recoverUsage matches a multi-line prompt whose snippet spans a newline", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-sessions-"));
  try {
    const dir = join(root, "proj");
    mkdirSync(dir);
    // Pi stores the composed prompt with newlines JSON-escaped (\n) — the exact
    // shape that made the coordinator's token recovery silently return null.
    const userLine = JSON.stringify({ message: { role: "user", content: [{ type: "text", text: "## policy\\n[YAGNI] Build ONLY what the task asks. Summarize the report." }] } });
    const asstLine = JSON.stringify({ message: { role: "assistant", model: "test/deepseek-v4-pro", usage: { input: 7830, output: 127, reasoning: 81, cacheRead: 3328, totalTokens: 11285 } } });
    writeFileSync(join(dir, "s.jsonl"), userLine + "\n" + asstLine + "\n");

    // dispatch builds the snippet from the RAW prompt: real newline -> space.
    const dispatchSnippet = "## policy\n[YAGNI] Build ONLY what the task asks".replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    const got = recoverUsage(0, dispatchSnippet, root);
    assert.ok(got, "usage recovered despite the escaped newline in the session");
    assert.equal(got.total, 11285);
    assert.equal(got.in, 7830);
    assert.equal(got.model, "test/deepseek-v4-pro");

    // A snippet that isn't present must NOT match (no false positive).
    assert.equal(recoverUsage(0, "totally unrelated marker text", root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
