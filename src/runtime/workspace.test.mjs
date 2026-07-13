import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureWorkspace, workspaceDelta } from "./workspace.mjs";

// Hermetic: capture against a scratch repo, not process.cwd() — the ambient
// repo's index can legitimately move between captures (CI checkout refresh,
// parallel test writers), which made this flake on Windows runners.
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ws-test-"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

test("workspace capture reports a repository without modifying it", () => {
  const dir = scratchRepo();
  const before = captureWorkspace(dir);
  const after = captureWorkspace(dir);
  const delta = workspaceDelta(before, after);
  assert.equal(before.git, true);
  assert.equal(delta.available, true);
  assert.equal(delta.changed, false);
});

test("workspace capture detects a change", () => {
  const dir = scratchRepo();
  const before = captureWorkspace(dir);
  writeFileSync(join(dir, "b.txt"), "new\n");
  const after = captureWorkspace(dir);
  const delta = workspaceDelta(before, after);
  assert.equal(delta.available, true);
  assert.equal(delta.changed, true);
});
