import { test } from "node:test";
import assert from "node:assert/strict";
import { captureWorkspace, workspaceDelta } from "./workspace.mjs";

test("workspace capture reports the current repository without modifying it", () => {
  const before = captureWorkspace(process.cwd());
  const after = captureWorkspace(process.cwd());
  const delta = workspaceDelta(before, after);
  assert.equal(before.git, true);
  assert.equal(delta.available, true);
  assert.equal(delta.changed, false);
});
