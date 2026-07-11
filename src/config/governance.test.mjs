import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateConfig, resolveModel, loadModelRegistry } from "./governance.mjs";

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// A minimal, valid registry + router the failure-case tests mutate.
function baseModels() {
  return {
    models: {
      m1: {
        provider: "p1",
        version: "v-1.0",
        plane: "frontier",
        capabilities: { tools: true, jsonSchema: true, contextWindow: 1000, streaming: true },
        active: true,
      },
      w1: {
        provider: "p2",
        version: "v-2.0",
        plane: "workhorse",
        capabilities: { tools: true, jsonSchema: false, contextWindow: 2000, streaming: true },
        active: true,
      },
    },
  };
}
function baseRouter() {
  return {
    prof: {
      categories: {
        code: { plane: "frontier", model: "m1" },
        cheap: { plane: "workhorse", model: "w1" },
      },
      default: "__judgment__",
    },
  };
}

function writeConfigs(routerObj, modelsObj) {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  tmpDirs.push(dir);
  const routerPath = join(dir, "router.json");
  const registryPath = join(dir, "models.json");
  writeFileSync(routerPath, JSON.stringify(routerObj));
  writeFileSync(registryPath, JSON.stringify(modelsObj));
  return { routerPath, registryPath };
}

test("the REAL shipped config validates clean (router.json + models.json)", () => {
  const { ok, errors } = validateConfig();
  assert.equal(ok, true, `expected clean config, got errors:\n${errors.join("\n")}`);
});

test("a valid custom config passes with no errors", () => {
  const { ok, errors, warnings } = validateConfig(writeConfigs(baseRouter(), baseModels()));
  assert.equal(ok, true, errors.join("\n"));
  assert.deepEqual(warnings, []);
});

test("routing to an unknown model is an error", () => {
  const router = baseRouter();
  router.prof.categories.code.model = "ghost";
  const { ok, errors } = validateConfig(writeConfigs(router, baseModels()));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /unknown model "ghost"/.test(e)));
});

test("routing to an INACTIVE model is an error (fail-closed)", () => {
  const models = baseModels();
  models.models.m1.active = false;
  const { ok, errors } = validateConfig(writeConfigs(baseRouter(), models));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /INACTIVE model "m1"/.test(e)));
});

test("a plane mismatch between router and registry is an error", () => {
  const router = baseRouter();
  router.prof.categories.code.plane = "workhorse"; // registry pins m1 to frontier
  const { ok, errors } = validateConfig(writeConfigs(router, baseModels()));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /plane mismatch/.test(e)));
});

test("an unknown plane in a router rule is an error", () => {
  const router = baseRouter();
  router.prof.categories.code.plane = "moon";
  const { ok, errors } = validateConfig(writeConfigs(router, baseModels()));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /unknown plane "moon"/.test(e)));
});

test("registry entries missing a pinned version or capabilities are errors", () => {
  const models = baseModels();
  delete models.models.m1.version;
  delete models.models.w1.capabilities;
  const { ok, errors } = validateConfig(writeConfigs(baseRouter(), models));
  assert.equal(ok, false);
  assert.ok(errors.some((e) => /missing pinned version/.test(e)));
  assert.ok(errors.some((e) => /missing capabilities/.test(e)));
});

test("a default that is neither __judgment__ nor a known category is a WARNING, not an error", () => {
  const router = baseRouter();
  router.prof.default = "nonexistent-category";
  const { ok, errors, warnings } = validateConfig(writeConfigs(router, baseModels()));
  assert.equal(ok, true, errors.join("\n"));
  assert.ok(warnings.some((w) => /default "nonexistent-category"/.test(w)));
});

test("resolveModel returns provider+version+plane for a known active model", () => {
  const registry = loadModelRegistry();
  const r = resolveModel("sonnet", { registry });
  assert.equal(r.model, "sonnet");
  assert.equal(r.provider, "anthropic-subscription");
  assert.equal(typeof r.version, "string");
  assert.equal(r.plane, "frontier");
  assert.ok(r.capabilities && typeof r.capabilities.tools === "boolean");
});

test("resolveModel throws on an unknown model", () => {
  assert.throws(() => resolveModel("does-not-exist"), /unknown model/);
});

test("a prototype-name model (e.g. 'constructor') is treated as unknown, not a phantom entry", () => {
  const router = baseRouter();
  router.prof.categories.code.model = "constructor"; // inherited Object member
  const { ok, errors } = validateConfig(writeConfigs(router, baseModels()));
  assert.equal(ok, false);
  assert.ok(
    errors.some((e) => /unknown model "constructor"/.test(e)),
    "must report unknown, not a misleading INACTIVE/phantom error",
  );
  assert.throws(() => resolveModel("constructor", { registry: baseModels() }), /unknown model/);
});

test("resolveModel is fail-closed on an inactive model unless allowInactive", () => {
  const registry = { models: { x: { provider: "p", version: "v", plane: "workhorse", capabilities: {}, active: false } } };
  assert.throws(() => resolveModel("x", { registry }), /inactive/);
  const forced = resolveModel("x", { registry, allowInactive: true });
  assert.equal(forced.active, false);
});

test("validateConfig surfaces a clear error on unreadable/invalid config", () => {
  const bad = validateConfig({ registryPath: "/nonexistent/models.json" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /cannot read/.test(e)));
});
