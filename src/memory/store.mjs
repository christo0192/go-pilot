// Tier-1 working memory — file-backed shared task store + boomerang collapse.
//
// The store coordinates worker claims ATOMICALLY so two workers never both run
// the same task. The atomic primitive is an O_EXCL file create
// (fs.openSync(path, "wx")): exactly one caller can create a task's claim
// marker; every other caller gets EEXIST and loses the race WITHOUT throwing.
// Because O_EXCL is enforced by the OS/filesystem, this guarantee holds across
// processes too, not just across concurrent promises in one process.
//
// State machine (per task):
//
//   pending ──claim──▶ claimed ──beginValidation──▶ validating
//                         │                              │
//                         ├────────── complete ──────────┼──▶ done
//                         └──────────── fail ────────────┴──▶ failed
//
//   claimed|validating ──(lease expired)── recoverStale ──▶ pending
//
// A claim is leased: `claim` returns an opaque token and stamps a
// `leaseExpiresAt`. Only the token holder may advance the task (beginValidation
// / complete / fail) or renew the lease (heartbeat). If the holder crashes and
// the lease expires, `recoverStale` returns the task to `pending` and drops the
// marker so another worker can re-claim — killing the orchestrator mid-task
// therefore neither loses the task nor lets a zombie double-complete it (its
// stale token no longer matches).
//
// Cascade/ready: each task carries `deps = [ids]`. A pending task is "ready"
// (and claimable) only when every dependency is `done`. Completing a task is
// therefore the cascade — it can flip its dependents from not-ready to ready.
//
// Durability: task JSON is written temp-then-rename so a crash mid-write can
// never leave a half-written (unparseable) record. State is one JSON file per
// task under `<root>/tasks/<id>.json`; claim markers live under
// `<root>/claims/<id>.claim`.

import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

const DEFAULT_LEASE_MS = 30_000;

// Terminal + active state sets used by the transition guards.
const ACTIVE = new Set(["claimed", "validating"]);

// Encode an id into a safe, reversible filename so ids can contain any
// characters (and can never escape the store directory via path traversal).
function idToFile(id) {
  return encodeURIComponent(String(id));
}

function fileToId(file) {
  return decodeURIComponent(file);
}

/**
 * Create a store rooted at `rootDir` (pass a temp dir in tests).
 *
 * @param {string} rootDir
 * @param {{now?: () => number, leaseMs?: number}} [opts]
 *   `now` — injectable clock (ms epoch) so lease/heartbeat/stale-claim
 *   behaviour is deterministic in tests. `leaseMs` — how long a claim survives
 *   without a heartbeat before `recoverStale` reclaims it.
 */
export function createStore(rootDir, opts = {}) {
  const tasksDir = join(rootDir, "tasks");
  const claimsDir = join(rootDir, "claims");
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(claimsDir, { recursive: true });

  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const leaseMs = Number.isFinite(opts.leaseMs) ? opts.leaseMs : DEFAULT_LEASE_MS;

  const taskPath = (id) => join(tasksDir, idToFile(id) + ".json");
  const claimPath = (id) => join(claimsDir, idToFile(id) + ".claim");

  // Per-store counter so tokens are unique even when two claims land on the
  // same clock tick. No Math.random — fully deterministic given the clock.
  let claimSeq = 0;
  let writeSeq = 0;

  function readTask(id) {
    const p = taskPath(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  }

  // Atomic persist: write a unique temp file, then rename over the target.
  // rename(2) is atomic within a filesystem, so a reader (or a crash) never
  // observes a partially written record.
  function writeTask(task) {
    const p = taskPath(task.id);
    const tmp = `${p}.${process.pid}.${writeSeq++}.tmp`;
    writeFileSync(tmp, JSON.stringify(task, null, 2), "utf8");
    renameSync(tmp, p);
  }

  function depsSatisfied(task, doneIds) {
    return (task.deps || []).every((d) => doneIds.has(d));
  }

  // Best-effort marker removal. ENOENT means it is already gone. Any other IO
  // error is swallowed so one stuck marker cannot wedge recovery of unrelated
  // tasks — the next recoverStale pass retries it (the sweep is idempotent).
  function dropMarker(id) {
    try {
      unlinkSync(claimPath(id));
    } catch (err) {
      if (err && err.code === "ENOENT") return;
      // transient (EPERM/EBUSY/…) — leave it for the next pass to retry.
    }
  }

  // Read + verify the caller holds the live claim before an advancing move.
  function requireHolder(op, id, token) {
    const task = readTask(id);
    if (!task) throw new Error(`${op}: unknown task "${id}"`);
    if (!ACTIVE.has(task.status)) {
      throw new Error(`${op}: task "${id}" is "${task.status}", not claimed/validating`);
    }
    if (token !== task.claimToken) {
      throw new Error(`${op}: claim-token mismatch for "${id}" (stale or wrong owner)`);
    }
    return task;
  }

  /**
   * Persist a new task as `pending`. Throws if the id already exists.
   * @param {{id: string, deps?: string[]}} task
   */
  function add(task) {
    if (!task || task.id === undefined || task.id === null || task.id === "") {
      throw new Error("add: task.id is required");
    }
    if (existsSync(taskPath(task.id))) {
      throw new Error(`add: task "${task.id}" already exists`);
    }
    const record = {
      ...task,
      id: task.id,
      deps: Array.isArray(task.deps) ? [...task.deps] : [],
      status: "pending",
      worker: null,
      claimToken: null,
      leaseExpiresAt: null,
      result: null,
      error: null,
    };
    writeTask(record);
    return record;
  }

  /**
   * ATOMIC claim. Refuses (returns null, never throws) when the id is unknown,
   * the task is not `pending`, a dependency is not yet `done`, or another
   * worker won the O_EXCL race. On success the returned task carries a
   * `claimToken` the holder must present to advance or complete it.
   *
   * @param {string} id
   * @param {string} worker
   * @returns {object|null} the claimed task on win, null otherwise
   */
  function claim(id, worker) {
    const task = readTask(id);
    if (!task) return null; // unknown id — no throw
    if (task.status !== "pending") return null; // already taken / finished
    // Deps gate: only claimable once every dependency is done.
    const doneIds = new Set(list().filter((t) => t.status === "done").map((t) => t.id));
    if (!depsSatisfied(task, doneIds)) return null;

    let fd;
    try {
      // O_EXCL create — the whole atomicity guarantee lives on this one line.
      fd = openSync(claimPath(id), "wx");
    } catch (err) {
      if (err && err.code === "EEXIST") return null; // lost the race
      throw err; // genuine IO failure — surface it
    }

    const at = now();
    // pid + per-store seq make the token unique even under a frozen clock and a
    // process restart, so a pre-crash token can never collide with a new one.
    const token = `${idToFile(id)}:${worker}:${process.pid}:${at}:${claimSeq++}`;
    try {
      writeFileSync(fd, JSON.stringify({ worker, token, claimedAt: at }));
    } finally {
      closeSync(fd);
    }

    task.status = "claimed";
    task.worker = worker;
    task.claimToken = token;
    task.leaseExpiresAt = at + leaseMs;
    task.error = null;
    writeTask(task);
    return task;
  }

  /**
   * Renew the lease on a held claim so a long-running task is not swept by
   * `recoverStale`. Requires the matching token.
   * @param {string} id
   * @param {string} token
   */
  function heartbeat(id, token) {
    const task = requireHolder("heartbeat", id, token);
    task.leaseExpiresAt = now() + leaseMs;
    writeTask(task);
    return task;
  }

  /**
   * claimed → validating. Requires the matching token.
   * @param {string} id
   * @param {string} token
   */
  function beginValidation(id, token) {
    const task = requireHolder("beginValidation", id, token);
    if (task.status !== "claimed") {
      throw new Error(`beginValidation: "${id}" is "${task.status}", not claimed`);
    }
    task.status = "validating";
    task.leaseExpiresAt = now() + leaseMs;
    writeTask(task);
    return task;
  }

  /**
   * claimed|validating → done. Requires the matching token; store its result.
   * @param {string} id
   * @param {any} result
   * @param {string} token
   */
  function complete(id, result, token) {
    const task = requireHolder("complete", id, token);
    task.status = "done";
    task.result = result === undefined ? null : result;
    task.leaseExpiresAt = null;
    writeTask(task);
    dropMarker(id); // terminal state — release the lock, bound the claims dir
    return task;
  }

  /**
   * claimed|validating → failed. Requires the matching token; record a reason.
   * A failed task's dependents stay blocked (deps require `done`).
   * @param {string} id
   * @param {any} reason  Error or string
   * @param {string} token
   */
  function fail(id, reason, token) {
    const task = requireHolder("fail", id, token);
    task.status = "failed";
    task.error = reason instanceof Error ? reason.message : reason ?? null;
    task.leaseExpiresAt = null;
    writeTask(task);
    dropMarker(id); // terminal state — release the lock, bound the claims dir
    return task;
  }

  /**
   * Crash recovery. Two reconciliations, both idempotent and safe to run at any
   * time (e.g. on orchestrator startup):
   *
   *   1. Expired lease — any claimed/validating task whose lease has passed is
   *      returned to `pending` (worker/token/lease cleared, marker dropped) so
   *      another worker can re-claim. A zombie holder's now-cleared token can no
   *      longer complete it.
   *   2. Orphan marker — a claim marker whose task is missing or is NOT actively
   *      held (crash between marker-create and the `claimed` write leaves the
   *      task `pending` with a live marker; terminal tasks may also leave one).
   *      Such a marker is dropped so the id is claimable again and the claims
   *      directory stays bounded. A healthy claimed/validating task keeps its
   *      marker (its lock must survive), so this never enables a double-claim.
   *
   * Returns the ids returned to `pending` by rule 1.
   * @param {number} [at]  override clock (ms epoch); defaults to now()
   * @returns {string[]}
   */
  function recoverStale(at = now()) {
    const recovered = [];
    const byId = new Map();

    // Rule 1: expired active claims -> pending.
    for (const task of list()) {
      byId.set(task.id, task);
      if (!ACTIVE.has(task.status)) continue;
      if (typeof task.leaseExpiresAt !== "number" || task.leaseExpiresAt > at) continue;
      dropMarker(task.id);
      task.status = "pending";
      task.worker = null;
      task.claimToken = null;
      task.leaseExpiresAt = null;
      writeTask(task);
      recovered.push(task.id);
    }

    // Rule 2: sweep markers no longer backed by an actively-held task. This is
    // what rescues a task orphaned by a crash mid-claim (task still `pending`,
    // marker present) — rule 1 alone would skip it since it is not ACTIVE.
    for (const f of readdirSync(claimsDir)) {
      if (!f.endsWith(".claim")) continue;
      const id = fileToId(f.slice(0, -".claim".length));
      const task = byId.has(id) ? byId.get(id) : readTask(id);
      if (!task || !ACTIVE.has(task.status)) dropMarker(id);
    }

    return recovered;
  }

  function get(id) {
    return readTask(id);
  }

  function list() {
    return readdirSync(tasksDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readTask(fileToId(f.slice(0, -".json".length))))
      .filter(Boolean);
  }

  /**
   * The cascade read-side: pending tasks whose every dep is `done`. Completing
   * a dependency is what makes a dependent appear here.
   * @returns {object[]}
   */
  function ready() {
    const all = list();
    const doneIds = new Set(all.filter((t) => t.status === "done").map((t) => t.id));
    return all.filter((t) => t.status === "pending" && depsSatisfied(t, doneIds));
  }

  // Alias: completing a task IS the cascade; expose ready() under that name too
  // for callers that think in terms of "what did completing this unblock".
  const cascade = ready;

  return {
    add,
    claim,
    heartbeat,
    beginValidation,
    complete,
    fail,
    recoverStale,
    get,
    list,
    ready,
    cascade,
  };
}

/**
 * Collapse a worker's exchange into a SHORT summary before it reports up.
 * Output length << input length. Calls NO LLM.
 *
 * `summarizeFn` is injectable (a real summarizer can be dropped in later). When
 * absent, a deterministic heuristic keeps any DECISION/RESULT lines plus the
 * final result line, capped to `maxChars`.
 *
 * @param {string|string[]} exchange  message strings (or one long string)
 * @param {(exchange: string|string[]) => string} [summarizeFn]
 * @param {{maxChars?: number}} [opts]
 * @returns {string}
 */
export function boomerang(exchange, summarizeFn, opts = {}) {
  if (typeof summarizeFn === "function") {
    return summarizeFn(exchange);
  }

  const maxChars = opts.maxChars ?? 280;

  const rawLines = Array.isArray(exchange)
    ? exchange.flatMap((m) => String(m).split("\n"))
    : String(exchange).split("\n");

  const lines = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);

  const kept = [];
  const seen = new Set();
  const push = (line) => {
    if (line && !seen.has(line)) {
      seen.add(line);
      kept.push(line);
    }
  };

  // Preserve any explicit DECISION/RESULT markers, in order.
  for (const line of lines) {
    if (/^(DECISION|RESULT)\b/i.test(line)) push(line);
  }
  // Always keep the final line — the outcome/result of the exchange.
  if (lines.length > 0) push(lines[lines.length - 1]);

  let summary = kept.join("\n");
  if (summary.length > maxChars) {
    summary = summary.slice(0, maxChars - 1).trimEnd() + "…";
  }
  return summary;
}
