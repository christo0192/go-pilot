// Frozen task manifest: load, validate, and content-hash the campaign fixtures
// (docs/live-test-plan.md §4). Every fixture must (a) pass the grader schema and
// (b) have a `category` that routes to its declared `armAModel` under the
// campaign profile — so Arm A exercises the REAL router, not a hardcoded model.
//
// Run directly for a self-check:  node scripts/baseline-rig/manifest.mjs
// Zero external deps (node builtins).

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateFixture, hashManifest } from "./grader.mjs";
import { resolveModel } from "../../src/config/governance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = join(HERE, "tasks");
const ROUTER_PATH = join(HERE, "..", "..", "config", "router.json");

/** Load campaign fixtures (skips helper files: _*.json and trivial-smoke.json). */
export function loadFixtures(dir = TASKS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_") && f !== "trivial-smoke.json");
  return files.sort().map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

/** Validate every fixture's schema + routing. Returns {ok, errors, hash, byArea}. */
export function validateManifest(fixtures, { profile = "ikey-hybrid", routerPath = ROUTER_PATH } = {}) {
  const router = JSON.parse(readFileSync(routerPath, "utf8"));
  const profileCats = router[profile]?.categories || {};
  const errors = [];
  const ids = new Set();
  const byArea = {};

  for (const fx of fixtures) {
    const tag = fx.file || fx.id || "<unknown>";
    const v = validateFixture(fx);
    if (!v.valid) errors.push(`${tag}: ${v.errors.join("; ")}`);
    if (fx.id) {
      if (ids.has(fx.id)) errors.push(`${tag}: duplicate id "${fx.id}"`);
      ids.add(fx.id);
    }
    // Routing: category must resolve to the declared Arm-A model under profile.
    const routed = profileCats[fx.category];
    if (!routed) errors.push(`${tag}: category "${fx.category}" not in profile "${profile}"`);
    else if (routed.model !== fx.armAModel) errors.push(`${tag}: category "${fx.category}" routes to ${routed.model}, not declared armAModel ${fx.armAModel}`);
    // Arm-A model must resolve and be a workhorse (the whole point of routing).
    try {
      const m = resolveModel(fx.armAModel);
      if (m.plane !== "workhorse") errors.push(`${tag}: armAModel ${fx.armAModel} is ${m.plane}, expected workhorse`);
    } catch (e) {
      errors.push(`${tag}: armAModel ${fx.armAModel} does not resolve (${e.message})`);
    }
    if (fx.area != null) (byArea[fx.area] ||= []).push(fx.id);
  }

  return { ok: errors.length === 0, errors, hash: hashManifest(fixtures), byArea, count: fixtures.length };
}

// CLI self-check.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixtures = loadFixtures();
  const res = validateManifest(fixtures);
  const areas = Object.keys(res.byArea).sort((a, b) => Number(a) - Number(b));
  process.stdout.write(`Loaded ${res.count} fixtures across ${areas.length} areas.\n`);
  for (const a of areas) process.stdout.write(`  area ${a}: ${res.byArea[a].join(", ")}\n`);
  process.stdout.write(`\nManifest hash: ${res.hash}\n`);
  if (res.ok) {
    process.stdout.write("VALIDATION: OK — all fixtures pass schema + routing.\n");
  } else {
    process.stdout.write(`VALIDATION: ${res.errors.length} error(s):\n`);
    for (const e of res.errors) process.stdout.write(`  - ${e}\n`);
    process.exit(1);
  }
}
