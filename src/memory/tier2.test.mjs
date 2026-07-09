// UNIT tests for the Tier-2 adapter selector (tier2.mjs). NO network here —
// mem0 shapes are asserted by structure only; behavior is only exercised for
// the mock (which is fully in-memory and synchronous).

import { test } from "node:test";
import assert from "node:assert/strict";

import { createTier2Adapter } from "./tier2.mjs";

/** Restore an env var to its prior value (or delete it) after a test. */
function withoutEnv(name, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const prev = process.env[name];
  delete process.env[name];
  try {
    return fn();
  } finally {
    if (had) process.env[name] = prev;
    else delete process.env[name];
  }
}

test('mode "mock" returns an { add, search } adapter', () => {
  const a = createTier2Adapter({ mode: "mock" });
  assert.equal(typeof a.add, "function");
  assert.equal(typeof a.search, "function");
});

test('mode "mem0" with an explicit baseUrl returns an { add, search } adapter (shape only)', () => {
  const a = createTier2Adapter({ mode: "mem0", baseUrl: "http://example.invalid:8888" });
  assert.equal(typeof a.add, "function");
  assert.equal(typeof a.search, "function");
  // Deliberately do NOT call add/search — no network in a unit test.
});

test('mode "mem0" with an unresolvable (blank) baseUrl and no env throws', () => {
  withoutEnv("MEM0_BASE_URL", () => {
    // A truly unresolvable baseUrl must throw. An UNDEFINED baseUrl falls back to
    // the localhost default (so the live integration test can run with no baseUrl);
    // an explicit EMPTY/blank string is nullish-preserved and rejected — that is
    // the "no baseUrl can be resolved" throw path.
    assert.throws(
      () => createTier2Adapter({ mode: "mem0", baseUrl: "", fetchImpl: () => {} }),
      /baseUrl/i,
    );
    assert.throws(
      () => createTier2Adapter({ mode: "mem0", baseUrl: "   ", fetchImpl: () => {} }),
      /baseUrl/i,
    );
  });
});

test('mode "auto" with no baseUrl/env returns a working in-memory mock', () => {
  withoutEnv("MEM0_BASE_URL", () => {
    const a = createTier2Adapter({ mode: "auto" });
    // Prove it is the mock by exercising it synchronously with no network.
    const stored = a.add({ text: "auto mode falls back to the mock", kind: "decision" });
    assert.ok(stored.id, "mock assigns an id");
    const hits = a.search("mock", 3);
    assert.ok(Array.isArray(hits));
    assert.equal(hits.length, 1);
    assert.match(hits[0].memory.text, /falls back to the mock/);
  });
});

test('mode "auto" with an explicit baseUrl returns a client shape (not called)', () => {
  const a = createTier2Adapter({ mode: "auto", baseUrl: "http://example.invalid:8888" });
  assert.equal(typeof a.add, "function");
  assert.equal(typeof a.search, "function");
});

test('mode "auto" uses the mock when MEM0_BASE_URL is unset (behavioral proof)', () => {
  withoutEnv("MEM0_BASE_URL", () => {
    const a = createTier2Adapter(); // default mode "auto"
    const r = a.add({ text: "sonnet handles coding on the frontier plane", kind: "decision" });
    assert.ok(r.id);
    // search returns synchronously (an array), which the HTTP client cannot do.
    const hits = a.search("coding", 5);
    assert.ok(Array.isArray(hits));
    assert.equal(hits.length, 1);
  });
});
