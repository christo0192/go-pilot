// Retrieval with an explicit degrade chain: CCE index -> file-path -> compressed.
//
// CCE (code-context-engine, elara-labs) is a local MCP context engine:
// tree-sitter chunking + hybrid (vector + FTS) retrieval, index under ~/.cce.
// When present and indexed, it returns the most relevant code chunks for a
// natural-language query — a real upgrade over blind truncation.
//
// DEGRADE-SAFE (D7/#8), cheapest-adequate tier first per the D7 ladder
// (Reference > Compressed > Full):
//   1. CCE semantic retrieval  -> returns matching chunks (rich, needs the tool)
//   2. plain file-path reference -> a POINTER to the best-matching file (a
//      "reference" — cheapest useful degrade; the reader fetches it themselves)
//   3. compressed -> grep output run through the rtk/truncate compressor
// retrieve() NEVER throws — a missing/failed tool must not hard-fail a pane.
//
// Node built-ins only (child_process, fs, os, path) + the local rtk-compress
// module. No external deps.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { compressOrFallback } from "./rtk-compress.mjs";

const _availCache = new Map();

/**
 * Is the cce binary present and runnable?
 * @param {{ cceBin?: string }} [opts]
 * @returns {boolean}
 */
export function cceAvailable({ cceBin = "cce" } = {}) {
  if (_availCache.has(cceBin)) return _availCache.get(cceBin);
  let ok = false;
  try {
    const r = spawnSync(cceBin, ["--version"], { encoding: "utf8", timeout: 5000 });
    ok = r.status === 0 && /cce|version/i.test((r.stdout || "") + (r.stderr || ""));
  } catch {
    ok = false;
  }
  _availCache.set(cceBin, ok);
  return ok;
}

/** Best-effort: has CCE built an index on this machine? (~/.cce exists) */
export function cceIndexed() {
  try {
    return existsSync(join(homedir(), ".cce"));
  } catch {
    return false;
  }
}

/** Test hook: clear the availability cache. */
export function _resetCceAvailability() {
  _availCache.clear();
}

function cceSearch(query, { cwd = process.cwd(), topK = 5, cceBin = "cce", timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cceBin, ["search", "--top-k", String(topK), query], { cwd, timeout });
    } catch (err) {
      reject(err);
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      const text = out + err;
      // Extract any repo file paths the results mention (e.g. src/foo/bar.mjs).
      const files = [...new Set(
        (text.match(/[\w./-]+\.(?:mjs|js|ts|py|md|json)\b/g) || []),
      )];
      resolve({ text, files, code });
    });
  });
}

// Tier-2 default: rank repo files by how many query tokens appear in them.
// Uses grep (present on the platform); returns [] on any failure.
function defaultFileFinder(query, cwd) {
  const tokens = [
    ...new Set(
      String(query)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3),
    ),
  ];
  if (tokens.length === 0) return [];
  const scores = new Map();
  for (const tok of tokens) {
    let r;
    try {
      r = spawnSync(
        "grep",
        ["-rli", "--include=*.mjs", "--include=*.md", "--exclude-dir=.git", "--exclude-dir=node_modules", tok, cwd],
        { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 * 8 },
      );
    } catch {
      continue;
    }
    if (r.status === 0 && r.stdout) {
      for (const f of r.stdout.split("\n").filter(Boolean)) {
        // Content hit = +1; a token in the file PATH (e.g. router.mjs for
        // "router") is a much stronger signal = +3, so source files named for
        // the query outrank prose docs that merely mention the words.
        const bump = f.toLowerCase().includes(tok) ? 4 : 1;
        scores.set(f, (scores.get(f) || 0) + bump);
      }
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

/**
 * Retrieve context for a query, degrade-safely.
 *
 * @param {string} query
 * @param {{
 *   cwd?: string, topK?: number, cceBin?: string, forceOff?: boolean,
 *   fileFinder?: (query: string, cwd: string) => string[]
 * }} [opts]
 * @returns {Promise<{ tier: "cce"|"reference"|"compressed", source: string, text: string, files?: string[], ref?: object }>}
 */
export async function retrieve(query, opts = {}) {
  const {
    cwd = process.cwd(),
    topK = 5,
    cceBin = "cce",
    forceOff = false,
    fileFinder = defaultFileFinder,
  } = opts;

  // Tier 1: CCE semantic index.
  if (!forceOff && cceAvailable({ cceBin }) && cceIndexed()) {
    try {
      const hit = await cceSearch(query, { cwd, topK, cceBin });
      if (hit && hit.text && hit.text.length > 0 && hit.files.length > 0) {
        return { tier: "cce", source: "cce", text: hit.text, files: hit.files };
      }
    } catch {
      // fall through
    }
  }

  // Tier 2: plain file-path reference (a pointer, not content).
  try {
    const files = fileFinder(query, cwd);
    if (files && files.length > 0) {
      return {
        tier: "reference",
        source: "file-path",
        text: files[0],
        files: files.slice(0, topK),
        ref: { path: files[0] },
      };
    }
  } catch {
    // fall through
  }

  // Tier 3: compressed — grep for the query, run through the rtk/truncate stub.
  const safe = String(query).replace(/'/g, "");
  const cmd = `grep -rn --include=*.mjs --exclude-dir=.git '${safe}' '${cwd}'`;
  const res = await compressOrFallback(cmd, { cwd });
  return { tier: "compressed", source: "compressed", text: res.text ?? "" };
}
