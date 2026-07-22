import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const controller = resolve(root, "scripts/gopilot-session.sh");
const hasHerdr = process.platform !== "win32" && spawnSync("herdr", ["--version"], { encoding: "utf8" }).status === 0;

function run(args, env) {
  return spawnSync("bash", [controller, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 20_000,
  });
}

function herdr(args) {
  const result = spawnSync("herdr", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function foreground(session) {
  const data = herdr(["--session", session, "pane", "process-info", "--pane", "w1:p1"]);
  return data.result.process_info.foreground_processes[0];
}

function waitForForeground(session, expectedName, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let process;
  while (Date.now() < deadline) {
    try { process = foreground(session); } catch {}
    if (process?.name === expectedName) return process;
    spawnSync("sleep", ["0.1"]);
  }
  assert.equal(process?.name, expectedName, `managed command did not become ${expectedName}`);
  return process;
}

test("named headless session reuses a live process and recovers after restart", { skip: !hasHerdr }, () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const session = `gopilot-live-${suffix}`;
  const label = `Go-pilot-live-${suffix}`;
  const env = {
    GOPILOT_HERDR_SESSION: session,
    GOPILOT_WORKSPACE_LABEL: label,
    GOPILOT_MANAGED_COMMAND: "sleep 120",
  };

  try {
    let result = run(["start"], env);
    assert.equal(result.status, 0, result.stderr);
    const first = waitForForeground(session, "sleep");

    result = run(["start"], env);
    assert.equal(result.status, 0, result.stderr);
    const reused = waitForForeground(session, "sleep");
    assert.equal(reused.pid, first.pid, "ordinary reopen must not duplicate the managed process");

    result = run(["restart"], env);
    assert.equal(result.status, 0, result.stderr);
    const recovered = waitForForeground(session, "sleep");
    assert.notEqual(recovered.pid, first.pid, "server restart must recreate the managed process");

    const workspaces = herdr(["--session", session, "workspace", "list"]);
    assert.equal(workspaces.result.workspaces[0].label, label, "Herdr must restore the named workspace");
  } finally {
    run(["stop"], env);
    spawnSync("herdr", ["session", "delete", session, "--json"], { encoding: "utf8", timeout: 10_000 });
  }
});
