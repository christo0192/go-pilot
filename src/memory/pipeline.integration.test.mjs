// LIVE integration test — the FULL Tier-2 pipeline against a REAL Mem0 server.
//
// Exercises gate -> promote (real HTTP writes) -> semantic search (real
// embeddings) -> recall (injection formatting), proving the seams work
// end-to-end against a running Mem0. It SELF-SKIPS when Mem0 is unreachable, so
// the suite stays green on machines without a server.
//
// promotion.mjs and recall.mjs are now ASYNC and `await` the adapter calls, so
// they work against BOTH the synchronous mock and the real async HTTP client.
// This test therefore drives them the natural way — `await promote(...)` yields
// a `promoted` list of fully-resolved memories (with durable Mem0 ids), and
// `await recall(adapter, query, opts)` performs the real semantic search and
// renders the bounded injection block against those live hits.
//
// When it runs, this test hits the real OpenAI embedder via Mem0 (a fraction of
// a cent).

import { test } from "node:test";
import assert from "node:assert/strict";

import { createTier2Adapter, isMem0Up } from "./tier2.mjs";
import { promote } from "./promotion.mjs";
import { recall } from "./recall.mjs";
import * as gate from "./gate.mjs";

test("full pipeline: promote (gate) -> recall against live Mem0", async (t) => {
  const up = await isMem0Up();
  if (!up) {
    t.skip("skipped: Mem0 not up at http://localhost:8888 (start it to run this live test)");
    return;
  }

  // UNIQUE userId per run so concurrent/repeated runs never pollute each other.
  const userId = "gopilot-itest-" + process.hrtime.bigint().toString();
  const adapter = createTier2Adapter({ mode: "mem0", userId });

  // (a) One KEEPER (passes noPlaceholders) and one FAILING candidate (TODO).
  const keeper = {
    memory: {
      text: "Go-pilot routes code tasks to the sonnet model on the frontier plane.",
      kind: "decision",
    },
    checks: [gate.noPlaceholders()],
  };
  const failing = {
    memory: { text: "scratch note TODO fix later", kind: "decision" },
    checks: [gate.noPlaceholders()],
  };

  // (b) Promote: the gate runs synchronously; the failing candidate is rejected
  // BEFORE any write, and the keeper's real HTTP write is awaited to completion.
  const report = await promote([keeper, failing], adapter);

  const failedEntry = report.skipped.find(
    (s) => s.memory && s.memory.text === "scratch note TODO fix later",
  );
  assert.ok(failedEntry, "the failing candidate appears in report.skipped");
  assert.equal(failedEntry.reason, "failed-gate", "it was rejected by the validation gate");

  // report.promoted holds fully-resolved memories (async adapter.add awaited).
  assert.equal(report.promoted.length, 1, "exactly one candidate promoted");
  assert.match(report.promoted[0].text, /sonnet/, "the keeper (sonnet routing) was persisted to Tier-2");
  assert.ok(report.promoted[0].id, "Mem0 assigned a durable id to the promoted memory");

  // (c) REAL end-to-end recall: recall() awaits the real semantic search and
  // renders the bounded injection block. The embedder must surface the keeper by
  // meaning; the failing scratch note was never written (gated out), so it can
  // never appear in the recalled context.
  const injection = await recall(adapter, "which model handles coding tasks?", { topK: 3 });

  assert.ok(injection.text.length > 0, "recall produced a non-empty injection block");
  assert.ok(injection.used.length >= 1, "recall included at least one live hit");
  assert.match(
    injection.text,
    /sonnet|routes/,
    "recalled context includes the keeper's distinctive wording (semantic hit)",
  );
  assert.doesNotMatch(injection.text, /scratch note/, "recall omits the gated-out note");
});
