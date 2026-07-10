// Real "compressed" tier backed by rtk (github.com/rtk-ai/rtk).
//
// rtk is a CLI proxy that filters/summarizes dev-command output before it
// reaches an LLM context. Used here as the REAL semantic compressor that the
// boundary guard's naive truncate+marker stub was standing in for (see
// ../boundary/guard.mjs and the D7 Reference > Compressed > Full invariant).
//
// DEGRADE-SAFE (D7/#8): if rtk is missing, un-spawnable, or errors, we fall
// back to running the command raw and applying the existing guard truncate
// stub. compressOrFallback() NEVER throws — a broken/absent tool must never
// hard-fail the pipeline.
//
// Convention: `command` is an rtk-PROXY-style command whose first token maps
// to an rtk subcommand — e.g. "git log --stat", "test node --test",
// "err npm run build". rtk is literally a proxy, so you replace `git log`
// with `rtk git log`. Commands whose first token is not an rtk subcommand
// will make rtk exit non-zero; compressOrFallback then degrades to the raw +
// truncate fallback.
//
// Node built-ins only (child_process). No external deps.

import { spawn, spawnSync } from "node:child_process";
import { guardBoundary, DEFAULT_THRESHOLD } from "./guard.mjs";

const _availCache = new Map();

/**
 * Is the rtk binary present and runnable on this machine?
 * Result is cached per binary name (spawnSync --version is cheap but tests
 * may probe repeatedly).
 *
 * @param {{ rtkBin?: string }} [opts]
 * @returns {boolean}
 */
export function rtkAvailable({ rtkBin = "rtk" } = {}) {
  if (_availCache.has(rtkBin)) return _availCache.get(rtkBin);
  let ok = false;
  try {
    const r = spawnSync(rtkBin, ["--version"], { encoding: "utf8", timeout: 5000 });
    ok = r.status === 0 && /rtk/i.test(r.stdout || "");
  } catch {
    ok = false;
  }
  _availCache.set(rtkBin, ok);
  return ok;
}

/** Test hook: clear the availability cache. */
export function _resetRtkAvailability() {
  _availCache.clear();
}

function tokenize(command) {
  return String(command).trim().split(/\s+/).filter(Boolean);
}

/**
 * Run `command` through rtk and resolve the compressed output text.
 *
 * Rejects only when rtk itself cannot be spawned (ENOENT / absent) — that is
 * the signal compressOrFallback uses to degrade. A non-zero exit from the
 * WRAPPED command (e.g. a failing test suite) still resolves: rtk's compressed
 * view of a failure is exactly what we want to forward.
 *
 * @param {string} command  rtk-proxy-style command, e.g. "git log --stat"
 * @param {{ cwd?: string, rtkBin?: string, timeout?: number }} [opts]
 * @returns {Promise<{ text: string, code: number|null }>}
 */
export function rtkCompress(command, { cwd = process.cwd(), rtkBin = "rtk", timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = tokenize(command);
    if (args.length === 0) {
      reject(new Error("rtkCompress: empty command"));
      return;
    }
    let child;
    try {
      child = spawn(rtkBin, args, { cwd, timeout });
    } catch (err) {
      reject(err);
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", reject); // ENOENT / spawn failure → degrade signal
    child.on("close", (code) => {
      resolve({ text: out + err, code });
    });
  });
}

function runRaw(command, { cwd, timeout = 120000 }) {
  try {
    const r = spawnSync("sh", ["-c", command], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32,
      timeout,
    });
    return (r.stdout || "") + (r.stderr || "");
  } catch (err) {
    return `rtk-compress fallback: command failed to run: ${err.message}`;
  }
}

/**
 * Compress a command's output for a pane boundary, degrade-safely.
 *
 * Chain: rtk (if available) -> raw command + guard truncate stub. Never throws.
 *
 * @param {string} command  rtk-proxy-style command, e.g. "git log --stat"
 * @param {{ cwd?: string, threshold?: number, rtkBin?: string, forceFallback?: boolean }} [opts]
 * @returns {Promise<{ text: string, tier: "compressed"|"full", source: "rtk"|"truncate-fallback", flagged: boolean }>}
 */
export async function compressOrFallback(command, opts = {}) {
  const {
    cwd = process.cwd(),
    threshold = DEFAULT_THRESHOLD,
    rtkBin = "rtk",
    forceFallback = false,
  } = opts;

  // Tier 1: real rtk compression.
  if (!forceFallback && rtkAvailable({ rtkBin })) {
    try {
      const { text } = await rtkCompress(command, { cwd, rtkBin });
      if (typeof text === "string" && text.length > 0) {
        return { text, tier: "compressed", source: "rtk", flagged: false };
      }
    } catch {
      // rtk vanished mid-flight — fall through to the stub.
    }
  }

  // Tier 2 (fallback): run raw + reuse the existing guard truncate stub.
  const raw = runRaw(command, { cwd });
  const guarded = guardBoundary({ tier: "full", content: raw }, { threshold });
  return {
    text: guarded.content ?? raw,
    tier: guarded.tier === "compressed" ? "compressed" : "full",
    source: "truncate-fallback",
    flagged: guarded.flagged,
  };
}
