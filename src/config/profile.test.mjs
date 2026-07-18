import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnvFile, selectProfile } from "./profile.mjs";

test("parseEnvFile handles comments, spaces, and quotes without executing shell", () => {
  assert.deepEqual(parseEnvFile("# x\n GOPILOT_PROFILE = 'ikey-prod'\nBAD-LINE\n"), { GOPILOT_PROFILE: "ikey-prod" });
});

test("profile precedence is CLI > process env > deploy env > runtime default", () => {
  const dir = mkdtempSync(join(tmpdir(), "profile-test-"));
  const envPath = join(dir, ".env");
  const runtimePath = join(dir, "runtime.json");
  writeFileSync(envPath, "GOPILOT_PROFILE=hybrid\n");
  writeFileSync(runtimePath, JSON.stringify({ defaultProfile: "pure-anthropic" }));
  assert.equal(selectProfile({ cliProfile: "ikey-prod", env: { GOPILOT_PROFILE: "open-first" }, envPath, runtimePath }), "ikey-prod");
  assert.equal(selectProfile({ env: { GOPILOT_PROFILE: "open-first" }, envPath, runtimePath }), "open-first");
  assert.equal(selectProfile({ env: {}, envPath, runtimePath }), "hybrid");
  assert.equal(selectProfile({ env: {}, envPath: join(dir, "missing"), runtimePath }), "pure-anthropic");
});
