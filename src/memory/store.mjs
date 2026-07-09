// Tier-1 working memory — file-backed shared task store + boomerang collapse.
//
// The store coordinates worker claims ATOMICALLY so two workers never both run
// the same task. The atomic primitive is an O_EXCL file create
// (fs.openSync(path, "wx")): exactly one caller can create a task's claim
// marker; every other caller gets EEXIST and loses the race WITHOUT throwing.
// Because O_EXCL is enforced by the OS/filesystem, this guarantee holds across
// processes too, not just across concurrent promises in one process.
//
// Cascade/ready: each task carries `deps = [ids]`. A pending task is "ready"
// only when every dependency is `done`. Completing a task is therefore the
// cascade — it can flip its dependents from not-ready to ready.
//
// State is persisted as one JSON file per task under `<root>/tasks/<id>.json`.
// Claim markers live under `<root>/claims/<id>.claim`.

import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";

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
 */
export function createStore(rootDir) {
  const tasksDir = join(rootDir, "tasks");
  const claimsDir = join(rootDir, "claims");
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(claimsDir, { recursive: true });

  const taskPath = (id) => join(tasksDir, idToFile(id) + ".json");
  const claimPath = (id) => join(claimsDir, idToFile(id) + ".claim");

  function readTask(id) {
    const p = taskPath(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  }

  function writeTask(task) {
    writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2), "utf8");
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
      result: null,
    };
    writeTask(record);
    return record;
  }

  /**
   * ATOMIC claim. Exactly one caller can create the claim marker via O_EXCL
   * ("wx"); losers get EEXIST → return null (never throw). Claiming an unknown
   * id also returns null.
   *
   * @param {string} id
   * @param {string} worker
   * @returns {object|null} the claimed task on win, null on loss / unknown id
   */
  function claim(id, worker) {
    const task = readTask(id);
    if (!task) return null; // unknown id — no throw

    let fd;
    try {
      // O_EXCL create — the whole atomicity guarantee lives on this one line.
      fd = openSync(claimPath(id), "wx");
    } catch (err) {
      if (err && err.code === "EEXIST") return null; // lost the race
      throw err; // genuine IO failure — surface it
    }
    try {
      writeFileSync(fd, JSON.stringify({ worker, ts: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }

    task.status = "claimed";
    task.worker = worker;
    writeTask(task);
    return task;
  }

  /**
   * Mark a claimed task done and store its result.
   * @param {string} id
   * @param {any} result
   */
  function complete(id, result) {
    const task = readTask(id);
    if (!task) throw new Error(`complete: unknown task "${id}"`);
    task.status = "done";
    task.result = result === undefined ? null : result;
    writeTask(task);
    return task;
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
    return all.filter(
      (t) => t.status === "pending" && (t.deps || []).every((d) => doneIds.has(d)),
    );
  }

  // Alias: completing a task IS the cascade; expose ready() under that name too
  // for callers that think in terms of "what did completing this unblock".
  const cascade = ready;

  return { add, claim, complete, get, list, ready, cascade };
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
