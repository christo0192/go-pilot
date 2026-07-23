import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, resolveMem0Config } from "./gopilot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "bin", "gopilot.mjs");

function run(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30000,
  });
}

test("CLI honors GOPILOT_PROFILE and reports pinned K2.5 extraction route", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gopilot-cli-"));
  const res = run(["run", "--dry-run", "--json", "--category", "extract", "--cwd", cwd, "extract name as JSON"], { GOPILOT_PROFILE: "ikey-prod" });
  if (res.error?.code === "EPERM") return t.skip("sandbox blocks child processes");
  assert.equal(res.status, 0, res.stderr);
  const body = JSON.parse(res.stdout);
  assert.equal(body.plan.profile, "ikey-prod");
  assert.equal(body.plan.model, "kimi-k2.5-ikey");
  assert.equal(body.plan.version, "test/kimi-k2.5");
  assert.equal(body.plan.fallback.model, "deepseek-ikey");
});

test("CLI infers extraction and routes low-confidence tasks through judgment", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "gopilot-cli-"));
  const inferred = run(["run", "--dry-run", "--json", "--cwd", cwd, "extract invoice fields into strict JSON"], { GOPILOT_PROFILE: "ikey-prod" });
  if (inferred.error?.code === "EPERM") return t.skip("sandbox blocks child processes");
  assert.equal(inferred.status, 0, inferred.stderr);
  assert.equal(JSON.parse(inferred.stdout).plan.category, "extract");

  const judged = run(["run", "--dry-run", "--json", "--cwd", cwd, "please handle the thing"], { GOPILOT_PROFILE: "ikey-prod" });
  assert.equal(judged.status, 0, judged.stderr);
  const body = JSON.parse(judged.stdout);
  assert.equal(body.plan.needsJudgment, true);
  assert.equal(body.plan.model, "opus");
});

test("top-level --help works and unknown flags fail closed", (t) => {
  const help = run(["--help"]);
  if (help.error?.code === "EPERM") return t.skip("sandbox blocks child processes");
  assert.equal(help.status, 0);
  const bad = run(["run", "--typo", "task"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option/);
});

test("CLI enables bounded summary promotion by default with an explicit opt-out", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.remember, true);
  assert.equal(defaults.kind, "summary");
  assert.equal(parseArgs(["--no-remember"]).remember, false);
  assert.equal(parseArgs(["--kind", "decision"]).kind, "decision");
});

test("Mem0 config loads installer-managed env and shell overrides it", () => {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-mem0-config-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, [
    "MEM0_BASE_URL=http://127.0.0.1:8888",
    "MEM0_MIN_SCORE=0.42",
    "MEM0_ADMIN_API_KEY=file-key",
  ].join("\n"));

  assert.deepEqual(resolveMem0Config({ env: {}, envPath }), {
    baseUrl: "http://127.0.0.1:8888",
    minScore: 0.42,
    apiKey: "file-key",
  });
  assert.deepEqual(resolveMem0Config({
    env: { MEM0_BASE_URL: "http://override:9999", MEM0_MIN_SCORE: "0.7", MEM0_ADMIN_API_KEY: "shell-key" },
    envPath,
  }), {
    baseUrl: "http://override:9999",
    minScore: 0.7,
    apiKey: "shell-key",
  });
});

test("Mem0 config stays optional and rejects an invalid relevance floor", () => {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-mem0-optional-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, "MEM0_ADMIN_API_KEY=   # prod-only; intentionally blank\n");
  assert.deepEqual(resolveMem0Config({ env: { MEM0_MIN_SCORE: "9" }, envPath }), {
    baseUrl: undefined,
    apiKey: undefined,
    minScore: 0.3,
  });
});
