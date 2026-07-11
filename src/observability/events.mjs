// Structured run/task observability event layer (Step 8.12).
//
// Done-when: "a failed or expensive run is diagnosable from its run ID." To get
// there we record every run/task lifecycle transition and its metrics as an
// append-only stream of events, then let the caller reconstruct a single run
// (`inspect`) or roll the whole stream up by dimension (`aggregate`).
//
// Two hard requirements shape the design:
//   1. SECRETS NEVER LAND IN THE LOG. Every event is redacted BEFORE it is
//      stored, so a token that slipped into an event payload can never leak out
//      through `all()`, a sink callback, or a diagnosis.
//   2. DETERMINISM / HERMETICITY. No `Date.now()`, no `Math.random()`: the clock
//      is injected (`now`, defaulting to the real `Date.now`) and the default
//      sink is an in-memory array. `seq` gives a stable monotonic order that
//      does not depend on clock resolution.
//
// We reuse the median/p90 helpers from the metrics package rather than
// re-implementing percentile math here.

import { median, p90 } from "../metrics/stats.mjs";

/** The sentinel a redacted value is replaced with. */
export const REDACTED = "[REDACTED]";

// Sensitive key WORD-PARTS. A key is redacted when any of its word-parts (see
// `tokenizeKey`) exactly equals one of these — NOT when the word merely appears
// as a substring.
//
// Word-part matching (not substring) is a deliberate tradeoff:
//   • It avoids over-redaction — a benign "monkey" is not treated as a "key",
//     and, crucially, the "tokens" metric field is preserved while a "token"
//     secret is redacted (substring matching would clobber the token count).
//   • The cost is under-redaction at glued word boundaries: "apiToken" and
//     "api_key" are caught (they split into parts) but a hypothetical
//     "secretsauce" written with no separator would not. In practice secret
//     keys are named with clear boundaries, so this is the right trade.
//
// "apikey" is listed explicitly because, unglued, it is a single part.
export const REDACTION_PATTERNS = Object.freeze([
  "token",
  "secret",
  "secrets",
  "apikey",
  "key",
  "keys",
  "password",
  "passwd",
  "authorization",
  "auth",
  "dsn",
  "credential",
  "credentials",
]);

const SENSITIVE_WORDS = new Set(REDACTION_PATTERNS);

/**
 * Split a key into lowercased word-parts, breaking on camelCase humps and on
 * any non-alphanumeric separator. `apiKey` → ["api","key"], `API_KEY` →
 * ["api","key"], `costUsd` → ["cost","usd"].
 * @param {string} key
 * @returns {string[]}
 */
function tokenizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // fooBar → foo Bar
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // APIKey → API Key
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
}

/**
 * Whether a key names a secret and its value must be redacted. Matches on
 * word-parts against the built-in list plus any caller-supplied `extra` set
 * (also matched against the whole lowercased key, so an exact extra key like
 * "ssn" works even when it isn't a natural word-part).
 * @param {string} key
 * @param {Set<string>} extra  lowercased extra keys/word-parts
 * @returns {boolean}
 */
function isSensitiveKey(key, extra) {
  const parts = tokenizeKey(key);
  for (const p of parts) {
    if (SENSITIVE_WORDS.has(p) || extra.has(p)) return true;
  }
  return extra.has(String(key).toLowerCase());
}

const isPlainObject = (v) => {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

function redactValue(value, extra) {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extra));
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // A sensitive key's value is replaced WHOLESALE — if `auth` holds a nested
      // object, the whole object is redacted so nothing inside it can leak.
      out[k] = isSensitiveKey(k, extra) ? REDACTED : redactValue(v, extra);
    }
    return out;
  }
  // Primitives (and non-plain objects like Date) are returned untouched. Deep
  // structures are rebuilt above, so the input is never mutated.
  return value;
}

/**
 * Deep-clone `obj`, replacing the VALUE of any sensitive key with `REDACTED`.
 * Recurses through nested objects and arrays. Never mutates the input.
 *
 * @template T
 * @param {T} obj
 * @param {{ extraKeys?: string[] }} [opts]  additional key names to redact
 * @returns {T}
 */
export function redact(obj, opts = {}) {
  const extra = new Set((opts.extraKeys ?? []).map((k) => String(k).toLowerCase()));
  return redactValue(obj, extra);
}

// Coerce a metric to a finite number for summing; anything else counts as 0.
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Fields surfaced in a run's diagnostic timeline (only when present on the event).
const TIMELINE_FIELDS = [
  "seq",
  "ts",
  "kind",
  "taskId",
  "phase",
  "category",
  "ok",
  "retries",
  "latencyMs",
  "costUsd",
  "tokens",
  "error",
];

function timelineEntry(rec) {
  const e = {};
  for (const f of TIMELINE_FIELDS) {
    if (rec[f] !== undefined) e[f] = rec[f];
  }
  return e;
}

/**
 * Create an event log.
 *
 * @param {object} [options]
 * @param {() => number} [options.now]   injected clock; defaults to `Date.now`.
 * @param {(record: object) => void} [options.sink]  optional callback invoked
 *        with each REDACTED record (in addition to the in-memory store).
 * @param {string[]} [options.redactKeys]  extra key names to redact on emit.
 * @returns {{
 *   emit: (event: object) => object,
 *   all: () => object[],
 *   byRun: (runId: unknown) => object[],
 *   inspect: (runId: unknown) => object,
 *   aggregate: (dimension: string) => Record<string, object>,
 * }}
 */
export function createEventLog(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const externalSink = typeof options.sink === "function" ? options.sink : null;
  const redactKeys = options.redactKeys ?? [];

  // The default sink: an in-memory, append-only, ordered store.
  const records = [];
  let seq = 0;

  /**
   * Stamp an event with `ts` (from the injected clock) and a monotonic `seq`,
   * REDACT it, store it, and fan it out to the optional sink. Returns the stored
   * (redacted) record.
   * @param {object} event  at least `{ runId, kind }`.
   * @returns {object}
   */
  function emit(event) {
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      throw new Error("emit: event must be an object");
    }
    // Spread first so an authoritative ts/seq always overrides any caller-set one.
    const stamped = { ...event, ts: now(), seq: seq++ };
    const record = redact(stamped, { extraKeys: redactKeys });
    records.push(record);
    if (externalSink) externalSink(record);
    return record;
  }

  /** All stored (redacted) records in emit order. */
  function all() {
    return records.slice();
  }

  /** Records for a single run, in emit order. */
  function byRun(runId) {
    return records.filter((r) => r.runId === runId);
  }

  /**
   * Reconstruct + diagnose a single run from its id. This is what makes a
   * failed/expensive run diagnosable: the timeline, summed totals, the failing
   * events, total retries, and the single slowest / most-expensive events.
   */
  function inspect(runId) {
    const evs = byRun(runId);
    const totals = { tokens: 0, costUsd: 0, latencyMs: 0 };
    const failures = [];
    let retries = 0;
    let slowest = null;
    let mostExpensive = null;

    for (const e of evs) {
      totals.tokens += num(e.tokens);
      totals.costUsd += num(e.costUsd);
      totals.latencyMs += num(e.latencyMs);
      retries += num(e.retries);
      if (e.ok === false || e.error != null) failures.push(e);
      if (typeof e.latencyMs === "number") {
        if (slowest === null || e.latencyMs > slowest.latencyMs) slowest = e;
      }
      if (typeof e.costUsd === "number") {
        if (mostExpensive === null || e.costUsd > mostExpensive.costUsd) mostExpensive = e;
      }
    }

    return {
      runId,
      events: evs.length,
      timeline: evs.map(timelineEntry),
      totals,
      failures,
      retries,
      slowest,
      mostExpensive,
    };
  }

  /**
   * Group the whole stream by `event[dimension]` (e.g. "model", "category",
   * "profile", "provider") and summarize each group. Records missing the
   * dimension are skipped. Returns a plain object keyed by the dimension value.
   *
   * Per group: `okRate` is over events that carry a boolean `ok` (null when
   * none do); `retryRate` is the fraction of events that retried at least once.
   */
  function aggregate(dimension) {
    const groups = new Map();
    for (const e of records) {
      const v = e[dimension];
      if (v == null) continue;
      const key = String(v);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    const out = {};
    for (const [key, evs] of groups) {
      let tokens = 0;
      let costUsd = 0;
      const latencies = [];
      let okEval = 0;
      let okTrue = 0;
      let retryHits = 0;

      for (const e of evs) {
        tokens += num(e.tokens);
        costUsd += num(e.costUsd);
        if (typeof e.latencyMs === "number") latencies.push(e.latencyMs);
        if (typeof e.ok === "boolean") {
          okEval += 1;
          if (e.ok) okTrue += 1;
        }
        if (num(e.retries) > 0) retryHits += 1;
      }

      out[key] = {
        count: evs.length,
        tokens,
        costUsd,
        okRate: okEval > 0 ? okTrue / okEval : null,
        retryRate: evs.length > 0 ? retryHits / evs.length : 0,
        latency: { median: median(latencies), p90: p90(latencies) },
      };
    }
    return out;
  }

  return { emit, all, byRun, inspect, aggregate };
}
