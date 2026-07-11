// Reliability layer — durable ids + append-only lifecycle journal.
//
// This is the crash-safety complement to the working-memory store: the store
// coordinates WHO runs a task; this journal makes running it EXACTLY-ONCE and
// RECOVERABLE across a process death. It gives two guarantees:
//
//   1. Idempotent dispatch — `dispatchOnce(key, fn)` runs fn at most once per
//      key. A retry after a completed key returns the cached result WITHOUT
//      re-invoking fn, so a duplicated dispatch never double-executes work.
//   2. Startup reconciliation — `reconcile()` lists keys that were in-flight
//      (a `start` with no `done`/`failed`) when the process died, so the caller
//      can re-drive them. Nothing in-flight is silently lost.
//
// Durability model: the journal is an append-only log — one JSON object per
// line (JSONL). Appends use fs.appendFileSync (open-append-close), so a record
// is written whole or, on a crash mid-append, leaves a truncated FINAL line.
// `read()` is crash-tolerant: an unparseable line (the classic torn tail, or a
// defensive middle-of-file corruption) is skipped, never thrown. The log is the
// single source of truth — state is folded from replaying it, not stored apart.
//
// Lifecycle events per key:
//
//   (none) ──start──▶ started ──done────▶ done   (result cached; fn never re-runs)
//                        │
//                        └────failed───▶ failed (error recorded; rethrown)
//
//   started (no done/failed) ── crash ──▶ reconcile() reports it as in-flight
//
// Determinism: `seq` is a per-instance counter and `ts` comes from an injected
// clock — no Date.now()/Math.random() in logic — so ids and records are
// reproducible given the same clock and call order.

import { appendFileSync, readFileSync, existsSync } from "node:fs";

/**
 * Deterministic run id from a seed and a sequence number. No clock, no
 * randomness — equal inputs always yield the same id.
 * @param {string|number} seed  a stable per-process/per-boot seed
 * @param {string|number} seq   a monotonically increasing counter
 * @returns {string}
 */
export function makeRunId(seed, seq) {
  return `run-${seed}-${seq}`;
}

/**
 * Deterministic task id scoped under a run. No clock, no randomness.
 * @param {string} runId  a run id (typically from makeRunId)
 * @param {string|number} seq  a monotonically increasing counter within the run
 * @returns {string}
 */
export function makeTaskId(runId, seq) {
  return `${runId}-task-${seq}`;
}

/**
 * Open (or create-on-first-append) an append-only journal at `filePath`.
 *
 * @param {string} filePath  path to the JSONL log file
 * @param {{now?: () => number}} [opts]
 *   `now` — injectable clock (ms epoch) stamped onto every record as `ts`, so
 *   append/dispatch behaviour is deterministic in tests. Defaults to Date.now.
 * @returns {{
 *   append: (event: object) => object,
 *   read: () => object[],
 *   reconcile: () => string[],
 *   readByKey: (key: string) => object[],
 *   dispatchOnce: (key: string, fn: () => any) => Promise<any>,
 *   path: string,
 * }}
 */
export function createJournal(filePath, opts = {}) {
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();

  // Per-instance monotonic counter. Combined with the injected clock this makes
  // every record's `seq` deterministic given call order — no randomness.
  let seq = 0;

  /**
   * Append ONE event as a JSON line. Stamps a monotonic `seq` and `ts = now()`.
   * appendFileSync opens O_APPEND, writes, and closes, so concurrent writers
   * never interleave a single record; a crash can only truncate the tail line.
   * @param {object} event  any JSON-serialisable object (should carry a `type`)
   * @returns {object} the stored record (event + seq + ts)
   */
  function append(event) {
    const record = { ...event, seq: seq++, ts: now() };
    // Trailing "\n" makes each record its own line; a crash mid-write leaves a
    // partial LAST line that read() discards.
    appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
    return record;
  }

  /**
   * Replay the log into an array of records. CRASH-TOLERANT: any line that does
   * not parse as JSON is skipped silently — never thrown. This rescues the
   * torn final line left by a crash mid-append (and defends against a corrupt
   * middle line too). A missing file replays as empty.
   * @returns {object[]}
   */
  function read() {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf8");
    const records = [];
    for (const line of raw.split("\n")) {
      if (line === "") continue; // blank/trailing separator, not a record
      try {
        records.push(JSON.parse(line));
      } catch {
        // Truncated or corrupt line (e.g. a crash mid-append) — skip it. This
        // is the core crash-safety property: bad lines cost data, not a throw.
        continue;
      }
    }
    return records;
  }

  /**
   * All records carrying the given `key`, in log (append) order.
   * @param {string} key
   * @returns {object[]}
   */
  function readByKey(key) {
    return read().filter((r) => r.key === key);
  }

  /**
   * Fold the log into the terminal-result-per-key it has recorded so far. A key
   * is present only once a `done` has been written for it; the stored `result`
   * is what a retry replays instead of re-running fn.
   * @returns {Map<string, any>}
   */
  function doneResults() {
    const done = new Map();
    for (const r of read()) {
      if (r && r.type === "done" && r.key !== undefined) {
        done.set(r.key, r.result);
      }
    }
    return done;
  }

  /**
   * Run `fn` at most once per `key` (idempotent dispatch).
   *
   * If the log already has a `{type:"done", key}` record, return its stored
   * `result` WITHOUT calling fn — so a retry after completion never
   * double-executes. Otherwise: append `{type:"start"}`, `await fn()`, then
   * append `{type:"done", result}` and return the result. If fn throws, append
   * `{type:"failed", error}` and rethrow.
   *
   * @param {string} key  stable idempotency key for this unit of work
   * @param {() => any} fn  the (async) work; its resolved value is cached
   * @returns {Promise<any>}
   */
  async function dispatchOnce(key, fn) {
    const done = doneResults();
    if (done.has(key)) {
      // Already completed — replay the cached result, do NOT re-run fn.
      return done.get(key);
    }

    append({ type: "start", key });
    let result;
    try {
      result = await fn();
    } catch (err) {
      // Record the failure (message only — Errors are not JSON-serialisable)
      // and rethrow so the caller decides whether to retry.
      append({ type: "failed", key, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    append({ type: "done", key, result: result === undefined ? null : result });
    return result;
  }

  /**
   * Startup reconciliation: keys that were in-flight at crash time — a `start`
   * with no matching `done` or `failed`. The caller re-drives these to recover
   * work that was interrupted. Completed (done) and terminated (failed) keys are
   * excluded. Idempotent and safe to call any time.
   * @returns {string[]} in-flight keys, in first-seen order
   */
  function reconcile() {
    const started = new Set();
    const settled = new Set();
    const order = [];
    for (const r of read()) {
      if (!r || r.key === undefined) continue;
      if (r.type === "start") {
        if (!started.has(r.key)) {
          started.add(r.key);
          order.push(r.key);
        }
      } else if (r.type === "done" || r.type === "failed") {
        settled.add(r.key);
      }
    }
    return order.filter((k) => !settled.has(k));
  }

  return { append, read, reconcile, readByKey, dispatchOnce, path: filePath };
}
