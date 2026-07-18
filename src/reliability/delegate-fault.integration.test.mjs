// Fault-injection tests for the delegation primitive (pi-delegate.sh) and its
// governance helpers. Hermetic: gateway pointed at a dead loopback port, key
// stubbed, ledger redirected to a temp file. No herdr/pi needed (raw mode only).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DELEGATE = join(ROOT, "scripts", "pi-delegate.sh");
const DEAD_GW = "http://127.0.0.1:9"; // discard port: instant ECONNREFUSED

function runDelegate(args, { log, extraEnv = {} } = {}) {
  return spawnSync("bash", [DELEGATE, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      DELEGATE_LOG: log,
      WORKHORSE_GATEWAY_KEY: "dummy-test-key",
      WORKHORSE_GATEWAY_URL: DEAD_GW,
      ...extraEnv,
    },
  });
}

test("unknown flag exits 4", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const res = runDelegate(["--bogus-flag", "deepseek", "hi"], { log: join(dir, "log.jsonl") });
  assert.equal(res.status, 4);
  assert.match(res.stderr, /unknown flag/);
});

test("raw mode against dead gateway fails cleanly, no stdout garbage, ledger written", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const log = join(dir, "log.jsonl");
  const res = runDelegate(["--raw", "--class", "fault-test", "deepseek", "test task"], { log });
  assert.notEqual(res.status, 0);
  assert.equal(res.stdout, "", "failed delegation must not print partial output");
  assert.match(res.stderr, /\[delegate failed\]/);
  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].model, "deepseek");
  assert.notEqual(lines[0].outcome, "ok");
  assert.equal(lines[0].class, "fault-test");
});

test("--repair on dead gateway runs full ladder (strict retry then sibling), all attempts in ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const log = join(dir, "log.jsonl");
  const res = runDelegate(["--raw", "--repair", "--class", "fault-repair", "deepseek", "test task"], { log });
  assert.notEqual(res.status, 0);
  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, "attempt 1 + strict retry + sibling");
  assert.deepEqual(lines.map((l) => l.attempt), [1, 2, 3]);
  assert.equal(lines[2].model, "kimi25", "third attempt reassigns to the K2.5 sibling");
});

test("--journal records the failed subtask outcome", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const jdir = join(dir, "journal");
  const res = runDelegate(
    ["--raw", "--journal", jdir, "--class", "fault-journal", "deepseek", "test task"],
    { log: join(dir, "log.jsonl") },
  );
  assert.notEqual(res.status, 0);
  const entries = readFileSync(join(jdir, "subtasks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].class, "fault-journal");
  assert.notEqual(entries[0].outcome, "ok");
  assert.notEqual(entries[0].exitCode, 0);
});

test("breaker-check: opens after N consecutive recent failures, ignores old/mixed", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const log = join(dir, "log.jsonl");
  const now = Date.now();
  const entry = (agoMs, outcome, model = "deepseek") =>
    JSON.stringify({ ts: new Date(now - agoMs).toISOString(), model, outcome, attempt: 1 });
  const check = (nowArg) =>
    spawnSync("node", [join(ROOT, "scripts", "breaker-check.mjs"), "deepseek", "--log", log, "--now", String(nowArg)], { encoding: "utf8" });

  // 3 consecutive recent failures → OPEN (exit 6)
  writeFileSync(log, [entry(120_000, "timeout"), entry(90_000, "empty"), entry(60_000, "error")].join("\n") + "\n");
  assert.equal(check(now).status, 6);
  assert.match(check(now).stdout, /"open":true/);

  // cooloff elapsed → closed
  assert.equal(check(now + 10 * 60_000).status, 0);

  // mixed outcomes → closed
  writeFileSync(log, [entry(120_000, "timeout"), entry(90_000, "ok"), entry(60_000, "error")].join("\n") + "\n");
  assert.equal(check(now).status, 0);

  // missing log → closed
  assert.equal(
    spawnSync("node", [join(ROOT, "scripts", "breaker-check.mjs"), "deepseek", "--log", join(dir, "nope.jsonl")], { encoding: "utf8" }).status,
    0,
  );
});

test("delegate refuses when breaker open on model AND sibling (exit 6)", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const log = join(dir, "log.jsonl");
  const now = Date.now();
  const entry = (agoMs, model) =>
    JSON.stringify({ ts: new Date(now - agoMs).toISOString(), model, outcome: "error", attempt: 1 });
  writeFileSync(
    log,
    [entry(90_000, "deepseek"), entry(80_000, "deepseek"), entry(70_000, "deepseek"),
     entry(60_000, "kimi25"), entry(50_000, "kimi25"), entry(40_000, "kimi25")].join("\n") + "\n",
  );
  const res = runDelegate(["--raw", "deepseek", "task"], { log });
  assert.equal(res.status, 6);
  assert.match(res.stderr, /breaker/);
  // --force-model bypasses the breaker (then fails on the dead gateway instead)
  const forced = runDelegate(["--raw", "--force-model", "deepseek", "task"], { log });
  assert.notEqual(forced.status, 6);
});

test("spend-guard: fresh cache under/over cap decides without network", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const cache = join(dir, "spend.json");
  const guard = (spend, cap) => {
    writeFileSync(cache, JSON.stringify({ ts: Date.now(), spend }));
    return spawnSync("node", [join(ROOT, "scripts", "spend-guard.mjs"), "--cache", cache, "--cap", String(cap)], {
      encoding: "utf8",
      env: { ...process.env, WORKHORSE_GATEWAY_KEY: "dummy" },
    });
  };
  assert.equal(guard(1.5, 7).status, 0);
  assert.equal(guard(9.99, 7).status, 7);
  assert.match(guard(9.99, 7).stdout, /"ok":false/);
});

test("delegate refuses over-budget (exit 7) unless --allow-over-budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "deleg-test-"));
  const log = join(dir, "log.jsonl");
  // Prime the DEFAULT cache location used by the delegate with an over-cap value.
  const cacheDefault = join(ROOT, "scripts", "baseline-rig", "out", "spend-cache.json");
  const hadCache = existsSync(cacheDefault);
  const prev = hadCache ? readFileSync(cacheDefault, "utf8") : null;
  writeFileSync(cacheDefault, JSON.stringify({ ts: Date.now(), spend: 99 }));
  try {
    const res = runDelegate(["--raw", "deepseek", "task"], { log, extraEnv: { GOPILOT_SPEND_CAP_USD: "7" } });
    assert.equal(res.status, 7);
    assert.match(res.stderr, /budget/);
    const allowed = runDelegate(["--raw", "--allow-over-budget", "deepseek", "task"], { log, extraEnv: { GOPILOT_SPEND_CAP_USD: "7" } });
    assert.notEqual(allowed.status, 7, "--allow-over-budget must bypass the refusal");
  } finally {
    if (prev !== null) writeFileSync(cacheDefault, prev);
    else writeFileSync(cacheDefault, JSON.stringify({ ts: 0, spend: 0 })); // stale ⇒ ignored
  }
});
