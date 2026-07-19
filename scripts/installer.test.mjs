import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

test("env key writer treats shell metacharacters as literal data and uses mode 600", () => {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-env-"));
  const envFile = join(dir, ".env");
  writeFileSync(envFile, "OTHER=kept\nWORKHORSE_GATEWAY_KEY=\n", { mode: 0o644 });
  const key = "sk-a&b|c$'\"d";
  const result = spawnSync(process.execPath, [join(root, "scripts/set-env-key.mjs"), envFile, "WORKHORSE_GATEWAY_KEY"], {
    env: { ...process.env, GOPILOT_WORKHORSE_KEY: key }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(envFile, "utf8"), `OTHER=kept\nWORKHORSE_GATEWAY_KEY=${key}\n`);
  if (process.platform !== "win32") assert.equal(statSync(envFile).mode & 0o777, 0o600);
});

test("Windows setup pins every Linux command to Ubuntu and masks key entry", () => {
  const ps = readFileSync(join(root, "setup-windows.ps1"), "utf8");
  assert.match(ps, /& wsl\.exe -d \$Distro @Arguments/);
  assert.doesNotMatch(ps, /Read-Host[^\n]+WORKHORSE[^\n]+(?<!-AsSecureString)$/m);
  assert.match(ps, /Read-Host \$Prompt -AsSecureString/);
  assert.match(ps, /GOPILOT_WORKHORSE_KEY\/u/);
  assert.match(ps, /Final one-click acceptance gate|install\.sh --one-click/);
});

test("the downloadable batch bootstrap fetches its PowerShell companion", () => {
  const cmd = readFileSync(join(root, "setup.cmd"), "utf8");
  assert.match(cmd, /raw\.githubusercontent\.com\/christo0192\/go-pilot\/main\/setup-windows\.ps1/);
  assert.match(cmd, /%TEMP%\\GoPilotSetup/);
  assert.match(cmd, /copy \/Y "%~f0" "%SETUP_CMD%"/);
  assert.match(cmd, /pushd "%SETUP_DIR%"/);
});

test("elevation reruns the staged bootstrap without rebuilding a quoted argument string", () => {
  const ps = readFileSync(join(root, "setup-windows.ps1"), "utf8");
  assert.match(ps, /Start-Process -FilePath \$BootstrapPath -Verb RunAs/);
  assert.doesNotMatch(ps, /Start-Process powershell\.exe -Verb RunAs -ArgumentList/);
});

test("one-click readiness requires both subscription CLIs and workhorse key", () => {
  const sh = readFileSync(join(root, "install.sh"), "utf8");
  assert.match(sh, /for item in node git pi herdr claude codex/);
  assert.match(sh, /MISS WORKHORSE_GATEWAY_KEY/);
  assert.match(sh, /@anthropic-ai\/claude-code/);
  assert.match(sh, /@openai\/codex/);
});
