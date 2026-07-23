// Promotion filter — Tier-1 (validated scratch) -> Tier-2 (Mem0 persistent).
//
// At run end, ONLY validated keepers are distilled into the Tier-2 store. This
// is the anti-bloat / anti-contamination boundary (D6): a candidate is promoted
// to persistent memory IFF it BOTH
//   (a) passes its validation gate (reuses `mustPass` from gate.mjs), AND
//   (b) is of a KEEPER kind (decision | summary | pref by default).
// Failed results (bad facts) and non-keeper scratch (debug/noise) are dropped,
// so they can never contaminate or bloat Tier-2.
//
// Pure aside from the `adapter.add(memory)` calls it makes for promoted items.
// Deterministic, order-preserving, and never mutates its inputs.

import { mustPass } from "./gate.mjs";

/** Default Tier-2 keeper kinds. Override via `opts.keeperKinds`. */
export const DEFAULT_KEEPER_KINDS = ["decision", "summary", "pref"];

/**
 * Promote validated keepers into the Mem0 adapter (Tier-2).
 *
 * @param {Array<{memory: {text: string, kind?: string, tags?: string[], meta?: Object}, checks?: Array<{name: string, run: function}>}>} candidates
 *   Each candidate wraps a mem0-adapter `memory` and an optional array of gate
 *   `checks` (as consumed by `mustPass`).
 * @param {{add: function, search: function}} adapter - a Mem0 adapter (e.g. `createMockMem0()`).
 * @param {{keeperKinds?: string[]}} [opts]
 * @returns {Promise<{promoted: Array<Object>, skipped: Array<{memory: Object, reason: string}>}>}
 *   Resolves to an object where `promoted` lists the memories returned by
 *   `adapter.add` (with ids), fully resolved for both the sync mock and the
 *   async HTTP adapter. `skipped` lists each rejected candidate with `reason` ∈
 *   "failed-gate" | "non-keeper-kind" | "duplicate".
 */
export async function promote(candidates, adapter, opts = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const keeperKinds = new Set(opts.keeperKinds ?? DEFAULT_KEEPER_KINDS);

  const promoted = [];
  const skipped = [];

  for (const candidate of list) {
    const memory = candidate && candidate.memory;
    const checks = candidate && Array.isArray(candidate.checks) ? candidate.checks : [];

    // (a) Gate first: a failed result must never reach Tier-2.
    if (!mustPass(memory, checks).passed) {
      skipped.push({ memory, reason: "failed-gate" });
      continue;
    }

    // (b) Keeper-kind second: only durable kinds are worth persisting. A missing
    // or non-keeper kind (e.g. "scratch", "debug") is intentionally dropped.
    if (!(memory && keeperKinds.has(memory.kind))) {
      skipped.push({ memory, reason: "non-keeper-kind" });
      continue;
    }

    // Exact normalized duplicates add recall noise without adding knowledge.
    // Search is best-effort: an unavailable read path must not prevent a valid
    // new keeper from being written, but a confirmed duplicate is skipped.
    if (opts.dedupe !== false && typeof adapter.search === "function") {
      try {
        const normalized = String(memory.text || "").replace(/\s+/g, " ").trim().toLowerCase();
        const hits = await adapter.search(memory.text, opts.dedupeTopK ?? 5);
        const duplicate = (hits || []).some((hit) =>
          String(hit?.memory?.text || "").replace(/\s+/g, " ").trim().toLowerCase() === normalized,
        );
        if (duplicate) {
          skipped.push({ memory, reason: "duplicate" });
          continue;
        }
      } catch { /* search unavailable: preserve the validated write path */ }
    }

    // Both gates cleared — persist to Tier-2. `adapter.add` returns the stored
    // memory (with its assigned id); that is what we report as promoted. Isolate
    // per item: a failed add (transient network / invalid record) must not abort
    // the batch or hide which keepers already landed in Tier-2.
    try {
      promoted.push(await adapter.add(memory));
    } catch (err) {
      skipped.push({ memory, reason: `add-failed: ${err.message}` });
    }
  }

  return { promoted, skipped };
}
