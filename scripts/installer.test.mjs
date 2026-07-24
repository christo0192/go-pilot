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

test("env default migration preserves existing values and adds new keys idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-env-merge-"));
  const template = join(dir, ".env.example");
  const target = join(dir, ".env");
  writeFileSync(template, "EXISTING=template\nMEM0_BASE_URL=\nMEM0_MIN_SCORE=0.3\n");
  writeFileSync(target, "EXISTING=user-secret\n", { mode: 0o644 });

  for (let i = 0; i < 2; i += 1) {
    const result = spawnSync(process.execPath, [join(root, "scripts/merge-env-defaults.mjs"), template, target], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const migrated = readFileSync(target, "utf8");
  assert.match(migrated, /^EXISTING=user-secret$/m);
  assert.equal((migrated.match(/^MEM0_BASE_URL=/gm) || []).length, 1);
  assert.equal((migrated.match(/^MEM0_MIN_SCORE=0\.3$/gm) || []).length, 1);
  if (process.platform !== "win32") assert.equal(statSync(target).mode & 0o777, 0o600);
});

test("Windows setup pins every Linux command to Ubuntu and masks key entry", () => {
  const ps = readFileSync(join(root, "setup-windows.ps1"), "utf8");
  assert.match(ps, /& wsl\.exe -d \$Distro @Arguments/);
  assert.doesNotMatch(ps, /Read-Host[^\n]+WORKHORSE[^\n]+(?<!-AsSecureString)$/m);
  assert.match(ps, /Read-Host \$Prompt -AsSecureString/);
  assert.match(ps, /GOPILOT_WORKHORSE_KEY\/u/);
  assert.match(ps, /\$_ -replace "`0", ''/);
  assert.doesNotMatch(ps, /\.Replace\(\[char\]0, ''\)/);
  assert.match(ps, /Final one-click acceptance gate|install\.sh --one-click/);
  assert.match(ps, /Install-GoPilotApp\.ps1/);
  assert.match(ps, /Programs\\Go-pilot\\GoPilot\.ps1/);
  assert.match(ps, /resumable Go-pilot session/);
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
  assert.match(sh, /MISS\/INVALID WORKHORSE_GATEWAY_KEY/);
  assert.match(sh, /@anthropic-ai\/claude-code/);
  assert.match(sh, /@openai\/codex/);
  assert.match(sh, /merge-env-defaults\.mjs/);
  assert.match(sh, /up -d --build --remove-orphans/);
});

test("one-click rejects Ctrl-V and other malformed gateway keys", () => {
  const ps = readFileSync(join(root, "setup-windows.ps1"), "utf8");
  const sh = readFileSync(join(root, "install.sh"), "utf8");
  assert.match(ps, /Test-WorkhorseKey/);
  assert.match(ps, /\^sk-\[\\x21-\\x7E\]\+\$/);
  assert.match(ps, /right-click or Shift\+Insert rather than Ctrl\+V/);
  assert.match(sh, /WORKHORSE_GATEWAY_KEY=sk-\[\[:graph:\]\]\+/);
});

test("desktop launcher preserves a named headless Herdr session", () => {
  const session = readFileSync(join(root, "scripts/gopilot-session.sh"), "utf8");
  const launch = readFileSync(join(root, "scripts/oneclick-launch.sh"), "utf8");
  assert.match(session, /GOPILOT_HERDR_SESSION:-gopilot/);
  assert.match(session, /nohup setsid herdr --session "\$SESSION" server/);
  assert.match(session, /pane_is_idle_shell/);
  assert.match(session, /scripts\/pi-resume\.sh/);
  assert.doesNotMatch(launch, /herdr server[^-]/);
  assert.match(launch, /gopilot-session\.sh" attach/);
});

test("Pi recovery uses its dedicated persisted session store", () => {
  const resume = readFileSync(join(root, "scripts/pi-resume.sh"), "utf8");
  assert.match(resume, /\.local\/share\/gopilot\/pi-sessions/);
  assert.match(resume, /--session-dir "\$SESSION_DIR" --continue/);
});

test("voice installer pins and verifies both executable and model", () => {
  const ps = readFileSync(join(root, "desktop/windows/Install-GoPilotVoice.ps1"), "utf8");
  assert.match(ps, /v1\.9\.1/);
  assert.match(ps, /7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539/);
  assert.match(ps, /bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30/);
  assert.match(ps, /Get-FileHash -Algorithm SHA256/);
});

test("Windows app installs a checksum-pinned Herdr terminal font on install and update", () => {
  const app = readFileSync(join(root, "desktop/windows/Install-GoPilotApp.ps1"), "utf8");
  const font = readFileSync(join(root, "desktop/windows/Install-GoPilotFont.ps1"), "utf8");
  assert.match(app, /Install-GoPilotFont\.ps1/);
  assert.match(font, /JetBrainsMonoNLNerdFontMono-Regular\.ttf/);
  assert.match(font, /ExpectedSha256/);
  assert.match(font, /Get-FileHash -Algorithm SHA256/);
  assert.match(font, /HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts/);
  assert.match(font, /JetBrainsMono NL Nerd Font Mono/);
  assert.match(font, /JetBrainsMonoNL NFM/);
  assert.match(font, /gopilot-font-backup/);
});

test("Windows app refresh propagates the Claude config and verified Herdr skill", () => {
  const app = readFileSync(join(root, "desktop/windows/Install-GoPilotApp.ps1"), "utf8");
  const launcher = readFileSync(join(root, "desktop/windows/GoPilot.ps1"), "utf8");
  assert.match(app, /claudeConfigLinuxPath/);
  assert.match(app, /USERPROFILE -replace '\\\\', '\/'/);
  assert.match(app, /skills\/herdr\/SKILL\.md/);
  assert.match(app, /install -m 0644/);
  assert.match(launcher, /CLAUDE_CONFIG_DIR=/);
});

test("voice paste is terminal-scoped and never submits Enter", () => {
  const ps = readFileSync(join(root, "desktop/windows/GoPilotVoice.ps1"), "utf8");
  assert.match(ps, /allowedProcesses/);
  assert.match(ps, /SendWait\('\^\+v'\)/);
  assert.doesNotMatch(ps, /SendWait\([^\n]*(?:ENTER|~)/i);
});

test("update policy validates candidates and only fast-forwards", () => {
  const sh = readFileSync(join(root, "scripts/gopilot-update.sh"), "utf8");
  const resolver = readFileSync(join(root, "scripts/gopilot-update-target.mjs"), "utf8");
  assert.match(sh, /tracked local changes detected/);
  assert.match(sh, /worktree add --quiet --detach/);
  assert.match(sh, /merge --ff-only/);
  assert.match(sh, /node scripts\/run-tests\.mjs unit/);
  assert.match(resolver, /run\.name === "CI"/);
  assert.match(resolver, /run\.conclusion === "success"/);
});

test("official Herdr skill is locked and installed for every frontier surface", () => {
  const lock = JSON.parse(readFileSync(join(root, "deploy/herdr-skill.lock.json"), "utf8"));
  const sh = readFileSync(join(root, "install.sh"), "utf8");
  assert.equal(lock.repository, "https://github.com/ogulcancelik/herdr");
  assert.match(lock.ref, /^v\d+\.\d+\.\d+$/);
  assert.match(lock.sha256, /^[0-9a-f]{64}$/);
  assert.match(sh, /herdr integration install "\$integration"/);
  assert.match(sh, /\.pi\/agent\/skills\/herdr/);
  assert.match(sh, /claude_config_dir\/skills\/herdr/);
  assert.match(sh, /codex_config_dir\/skills\/herdr/);
  assert.match(sh, /CLAUDE_CONFIG_DIR/);
  assert.match(sh, /CODEX_HOME/);
});

test("Pi resource merger preserves user settings and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "gopilot-pi-settings-"));
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ theme: "kept", skills: ["/user/skill"] }));
  const script = join(root, "scripts/install-pi-resources.mjs");
  for (let i = 0; i < 2; i += 1) {
    const result = spawnSync(process.execPath, [script, settings, root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const merged = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(merged.theme, "kept");
  assert.deepEqual(merged.skills.filter(x => x === join(root, ".pi", "skills")), [join(root, ".pi", "skills")]);
  assert.deepEqual(merged.extensions, [join(root, ".pi", "extensions", "tool-call-repair.ts")]);
});
