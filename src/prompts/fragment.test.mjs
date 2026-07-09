import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadFragment, withYagni } from "./fragment.mjs";

test("real fragment file contains the [YAGNI] marker", () => {
  const fragment = loadFragment();
  assert.match(fragment, /\[YAGNI\]/);
});

test("withYagni composes fragment before the original prompt", () => {
  const dir = mkdtempSync(join(tmpdir(), "yagni-"));
  const path = join(dir, "fixture.txt");
  writeFileSync(path, "[YAGNI] fixture marker line\nbe terse\n", "utf8");

  const original = "Implement the login handler.";
  try {
    const composed = withYagni(original, { path });

    // (a) contains the marker
    assert.match(composed, /\[YAGNI\]/);
    // (b) contains the original prompt text
    assert.ok(composed.includes(original));
    // (c) fragment comes BEFORE the original prompt
    assert.ok(composed.indexOf("[YAGNI]") < composed.indexOf(original));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withYagni returns just the fragment when prompt is empty/undefined", () => {
  const dir = mkdtempSync(join(tmpdir(), "yagni-"));
  const path = join(dir, "fixture.txt");
  const fragmentText = "[YAGNI] fixture marker line";
  writeFileSync(path, fragmentText + "\n", "utf8");

  try {
    assert.equal(withYagni("", { path }), fragmentText);
    assert.equal(withYagni(undefined, { path }), fragmentText);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadFragment trims surrounding whitespace", () => {
  const dir = mkdtempSync(join(tmpdir(), "yagni-"));
  const path = join(dir, "fixture.txt");
  writeFileSync(path, "\n\n[YAGNI] padded\n\n", "utf8");

  try {
    assert.equal(loadFragment({ path }), "[YAGNI] padded");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
