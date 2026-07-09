// Tier-2 adapter SELECTOR — pick the persistent-memory backend from config.
//
// Both `createMockMem0()` (deterministic in-memory) and `createMem0Client()`
// (real HTTP Mem0) implement the SAME { add, search } contract. Downstream
// modules — promotion.mjs and recall.mjs — are already adapter-agnostic, so the
// ONLY wiring needed is a thin factory that chooses which backend to build from
// runtime config. This module is that factory. It holds ZERO business logic.
//
// Modes:
//   "mock"  -> always the in-memory mock (no network).
//   "mem0"  -> always the real HTTP client (requires a resolvable baseUrl).
//   "auto"  -> real client IFF a baseUrl is resolvable (opts.baseUrl or the
//              MEM0_BASE_URL env var), else the mock. This is the default.
//
// baseUrl resolution order for the real client: opts.baseUrl, then
// process.env.MEM0_BASE_URL, then the local default "http://localhost:8888".

import { createMockMem0 } from "./mem0-adapter.mjs";
import { createMem0Client } from "./mem0-client.mjs";

/** Local self-hosted Mem0 default endpoint. */
const DEFAULT_BASE_URL = "http://localhost:8888";

/**
 * Is an explicit baseUrl CONFIGURED (opts or env)? Used by "auto" to decide
 * between the real client and the mock WITHOUT probing the network. Note the
 * deliberate asymmetry with "mem0" mode: "auto" does NOT count the localhost
 * default as configured — it goes real only when someone opted in explicitly.
 *
 * @param {{baseUrl?: string}} opts
 * @returns {boolean}
 */
function hasConfiguredBaseUrl(opts) {
  const fromOpts = typeof opts.baseUrl === "string" && opts.baseUrl.trim() !== "";
  const fromEnv =
    typeof process.env.MEM0_BASE_URL === "string" && process.env.MEM0_BASE_URL.trim() !== "";
  return fromOpts || fromEnv;
}

/**
 * Build the real Mem0 HTTP client for "mem0" mode.
 *
 * baseUrl resolves via the nullish chain opts.baseUrl ?? MEM0_BASE_URL ?? local
 * default. So an UNDEFINED baseUrl (nothing configured) falls back to
 * http://localhost:8888 — this is what lets the live integration test build a
 * mem0 adapter with no baseUrl and still reach the running local server. An
 * explicit EMPTY/blank baseUrl, however, is nullish-preserved as "" and handed
 * to createMem0Client, which rejects it — that is the "no baseUrl can be
 * resolved -> throw" path.
 *
 * @param {object} opts
 * @returns {{add: Function, search: Function}}
 */
function buildMem0Client(opts) {
  const baseUrl = opts.baseUrl ?? process.env.MEM0_BASE_URL ?? DEFAULT_BASE_URL;

  // createMem0Client throws a clear "baseUrl is required" on empty/blank input;
  // an explicit blank string reaches here unchanged (?? only fills null/undefined).
  return createMem0Client({
    baseUrl,
    userId: opts.userId ?? "gopilot",
    fetchImpl: opts.fetchImpl,
    apiKey: opts.apiKey,
  });
}

/**
 * Create a Tier-2 memory adapter, selecting the backend by `opts.mode`.
 *
 * @param {object} [opts]
 * @param {"auto"|"mock"|"mem0"} [opts.mode="auto"]  Backend selector.
 * @param {string} [opts.baseUrl]     Mem0 base URL (mem0/auto). Falls back to
 *                                     MEM0_BASE_URL, then http://localhost:8888.
 * @param {string} [opts.userId]      Mem0 partition key (default "gopilot").
 * @param {Function} [opts.fetchImpl] fetch-compatible impl (default global fetch).
 * @param {string} [opts.apiKey]      optional Mem0 X-API-Key.
 * @returns {{add: Function, search: Function}}  A { add, search } adapter.
 */
export function createTier2Adapter(opts = {}) {
  const mode = opts.mode ?? "auto";

  switch (mode) {
    case "mock":
      return createMockMem0();

    case "mem0":
      return buildMem0Client(opts);

    case "auto":
      return hasConfiguredBaseUrl(opts) ? buildMem0Client(opts) : createMockMem0();

    default:
      throw new Error(
        `createTier2Adapter: unknown mode "${mode}" (expected "auto" | "mock" | "mem0").`,
      );
  }
}

/**
 * Liveness probe: is a Mem0 server answering at `${baseUrl}/docs` with HTTP 200?
 * Short-timeout, non-throwing — returns false on any error/timeout/non-200. Used
 * by the integration test to self-skip gracefully when Mem0 is down.
 *
 * @param {string} [baseUrl="http://localhost:8888"]
 * @param {{fetchImpl?: Function}} [options]
 * @returns {Promise<boolean>} true iff the probe got HTTP 200.
 */
export async function isMem0Up(baseUrl = DEFAULT_BASE_URL, { fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") return false;

  const root = String(baseUrl).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await doFetch(root + "/docs", {
      method: "GET",
      signal: controller.signal,
    });
    return res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
