#!/usr/bin/env node
// Fail-closed structural scoring for the desktop release rubric. Runtime
// behavior is exercised by installer.test.mjs and session-lifecycle.live.test;
// this check prevents a release from silently dropping required evidence.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rubric = JSON.parse(readFileSync(resolve(root, "config/desktop-quality-rubric.json"), "utf8"));
const dimensions = new Map(rubric.dimensions.map(d => [d.id, d]));

const totalWeight = rubric.dimensions.reduce((sum, d) => sum + d.weight, 0);
if (totalWeight !== 100) throw new Error(`desktop rubric weights total ${totalWeight}, expected 100`);
if (!Number.isFinite(rubric.stableThreshold) || rubric.stableThreshold < 90) {
  throw new Error("desktop stableThreshold must remain at least 90");
}

function text(path) {
  return readFileSync(resolve(root, path), "utf8");
}
function evidence(file, patterns) {
  const content = text(file);
  return patterns.every(pattern => pattern.test(content));
}

const results = new Map([
  ["resume-correctness", evidence("scripts/session-lifecycle.live.test.mjs", [
    /ordinary reopen must not duplicate/,
    /server restart must recreate/,
    /Herdr must restore the named workspace/,
  ]) && evidence("scripts/gopilot-session.sh", [/nohup setsid herdr/, /pane_is_idle_shell/])],
  ["install-reliability", evidence("desktop/windows/Install-GoPilotApp.ps1", [
    /Start Menu\\Programs\\Go-pilot/,
    /CurrentVersion\\Uninstall\\Go-pilot/,
    /New-GoPilotShortcut/,
  ]) && evidence("scripts/installer.test.mjs", [/Install-GoPilotApp/, /PowerShell/, /official Herdr skill/])
    && evidence("install.sh", [/herdr integration install "\$integration"/, /install_verified_herdr_skill/])],
  ["update-safety", evidence("scripts/gopilot-update.sh", [
    /tracked local changes detected/,
    /worktree add --quiet --detach/,
    /merge --ff-only/,
    /update-state\.json/,
    /--rollback/,
  ]) && evidence("scripts/gopilot-update-target.mjs", [/conclusion === "success"/, /releases\/latest/])],
  ["voice-privacy-safety", evidence("desktop/windows/Install-GoPilotVoice.ps1", [
    /Get-FileHash -Algorithm SHA256/,
    /ggml-small\.en-q5_1\.bin/,
  ]) && evidence("desktop/windows/GoPilotVoice.ps1", [
    /allowedProcesses/,
    /SendWait\('\^\+v'\)/,
    /Deliberately never send Enter/,
  ])],
  ["regression-quality", evidence(".github/workflows/ci.yml", [
    /npm run test:unit/,
    /npm run test:integration/,
    /npm run check:routing/,
    /npm run check:metrics/,
    /session-lifecycle\.live\.test\.mjs/,
  ])],
  ["documentation-operability", evidence("docs/desktop-app-plan.md", [
    /Quality scoring rubric/,
    /Explicit limitations/,
    /recovery/i,
  ])],
]);

let score = 0;
for (const [id, dimension] of dimensions) {
  const pass = results.get(id) === true;
  if (pass) score += dimension.weight;
  process.stdout.write(`${pass ? "PASS" : "FAIL"} ${id} (${pass ? dimension.weight : 0}/${dimension.weight})\n`);
}
process.stdout.write(`desktop quality score: ${score}/100 (stable threshold ${rubric.stableThreshold})\n`);
if (score < rubric.stableThreshold || [...results.values()].some(value => value !== true)) process.exit(1);
