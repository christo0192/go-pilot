import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  loadToolProfiles,
  resolveProfile,
  piToolArgs,
  PI_BUILTIN_TOOLS,
} from "./tool-profiles.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const ROUTER_CONFIG = resolve(REPO_ROOT, "config", "router.json");

// The 10 work-categories the router knows about (config/router.json).
const ROUTER_CATEGORIES = [
  "orchestrate", "plan", "code", "analyze", "draft",
  "extract", "classify", "summarize", "code-review", "lateral",
];

test("tool-profiles: config loads and has categories + a valid default", () => {
  const profiles = loadToolProfiles();
  assert.equal(typeof profiles.categories, "object");
  assert.ok(Array.isArray(profiles.default.tools));
  assert.ok(profiles.default.tools.length > 0, "default profile should not be empty");
});

test("tool-profiles: every profile uses only REAL Pi built-in tool names", () => {
  const profiles = loadToolProfiles();
  const entries = [
    ...Object.entries(profiles.categories),
    ["default", profiles.default],
  ];
  for (const [name, entry] of entries) {
    for (const t of entry.tools) {
      assert.ok(
        PI_BUILTIN_TOOLS.includes(t),
        `profile "${name}" references unknown Pi tool "${t}" (not one of ${PI_BUILTIN_TOOLS.join(",")})`,
      );
    }
  }
});

test("tool-profiles: DONE-WHEN — extract and code yield DIFFERENT, correct tool args", () => {
  const profiles = loadToolProfiles();
  const extractArgs = piToolArgs("extract", { profiles });
  const codeArgs = piToolArgs("code", { profiles });

  // Both are allowlists.
  assert.equal(extractArgs[0], "--tools");
  assert.equal(codeArgs[0], "--tools");

  // They must differ — the whole point of per-worker subsets.
  assert.notDeepEqual(extractArgs, codeArgs);

  // extract = read-only + minimal: read/grep/find, and crucially NO mutation/shell.
  const extractTools = extractArgs[1].split(",");
  assert.deepEqual(extractTools, ["read", "grep", "find"]);
  for (const forbidden of ["bash", "edit", "write"]) {
    assert.ok(!extractTools.includes(forbidden), `extract must NOT expose "${forbidden}"`);
  }

  // code = fuller: must include the coding tools + search.
  const codeTools = codeArgs[1].split(",");
  for (const needed of ["read", "edit", "write", "bash", "grep", "find"]) {
    assert.ok(codeTools.includes(needed), `code must expose "${needed}"`);
  }
});

test("tool-profiles: unknown category falls back to the default profile", () => {
  const profiles = loadToolProfiles();
  const resolved = resolveProfile("does-not-exist", { profiles });
  assert.equal(resolved.category, "default");
  assert.equal(resolved.fromDefault, true);
  assert.deepEqual(resolved.tools, profiles.default.tools);

  // And the args match the default allowlist.
  assert.deepEqual(
    piToolArgs("totally-unknown", { profiles }),
    ["--tools", profiles.default.tools.join(",")],
  );
});

test("tool-profiles: missing/empty category also falls back to default", () => {
  const profiles = loadToolProfiles();
  assert.equal(resolveProfile(undefined, { profiles }).category, "default");
  assert.equal(resolveProfile("", { profiles }).category, "default");
  assert.equal(resolveProfile(null, { profiles }).category, "default");
});

test("tool-profiles: every router category has a profile (no accidental default fallback)", () => {
  const profiles = loadToolProfiles();
  const routerCfg = JSON.parse(readFileSync(ROUTER_CONFIG, "utf8"));

  // Sanity: our category list matches what's actually in router.json.
  const cfgCategories = new Set();
  for (const profile of Object.values(routerCfg)) {
    for (const cat of Object.keys(profile.categories || {})) cfgCategories.add(cat);
  }
  for (const cat of ROUTER_CATEGORIES) {
    assert.ok(cfgCategories.has(cat), `router.json is expected to define category "${cat}"`);
  }

  // Each router category resolves to its OWN profile, not the default fallback.
  for (const cat of ROUTER_CATEGORIES) {
    const resolved = resolveProfile(cat, { profiles });
    assert.equal(resolved.fromDefault, false, `category "${cat}" should have its own profile`);
    assert.ok(resolved.tools.length > 0, `category "${cat}" profile should not be empty`);
    assert.ok(resolved.tools.includes("read"), `category "${cat}" should at least be able to read`);
  }
});

test("tool-profiles: read-only categories never expose mutation or shell", () => {
  const profiles = loadToolProfiles();
  const readOnly = ["plan", "extract", "classify", "summarize", "code-review", "analyze", "lateral"];
  for (const cat of readOnly) {
    const tools = resolveProfile(cat, { profiles }).tools;
    for (const forbidden of ["edit", "write"]) {
      assert.ok(!tools.includes(forbidden), `read-only category "${cat}" must NOT expose "${forbidden}"`);
    }
  }
});

test("tool-profiles: piToolArgs is deterministic", () => {
  const profiles = loadToolProfiles();
  for (const cat of [...ROUTER_CATEGORIES, "unknown-x"]) {
    assert.deepEqual(piToolArgs(cat, { profiles }), piToolArgs(cat, { profiles }));
  }
});

test("tool-profiles: an empty tools array yields --no-tools", () => {
  // Build a throwaway config with an empty profile to prove the --no-tools branch.
  const dir = mkdtempSync(resolve(tmpdir(), "toolprofiles-"));
  const p = resolve(dir, "tp.json");
  writeFileSync(
    p,
    JSON.stringify({
      categories: { locked: { tools: [] } },
      default: { tools: ["read"] },
    }),
  );
  const profiles = loadToolProfiles(p);
  assert.deepEqual(piToolArgs("locked", { profiles }), ["--no-tools"]);
});

test("tool-profiles: loadToolProfiles throws on a missing file", () => {
  assert.throws(() => loadToolProfiles("/no/such/tool-profiles.json"), /cannot read config/);
});

test("tool-profiles: resolveProfile requires profiles to be passed", () => {
  assert.throws(() => resolveProfile("code", {}), /requires opts\.profiles/);
});
