import { spawnSync } from "node:child_process";

function git(args, cwd) {
  const out = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  return { ok: out.status === 0, text: (out.stdout || "") + (out.stderr || "") };
}

export function captureWorkspace(cwd = process.cwd()) {
  const head = git(["rev-parse", "HEAD"], cwd);
  const status = git(["status", "--short"], cwd);
  const diff = git(["diff", "--binary", "--no-ext-diff"], cwd);
  return {
    git: head.ok,
    head: head.ok ? head.text.trim() : null,
    status: status.text,
    diff: diff.text,
  };
}

export function workspaceDelta(before, after) {
  if (!before.git || !after.git) return { available: false, changed: false, diff: "", status: after.status || "" };
  return {
    available: true,
    changed: before.status !== after.status || before.diff !== after.diff || before.head !== after.head,
    headBefore: before.head,
    headAfter: after.head,
    status: after.status,
    diff: after.diff,
  };
}
