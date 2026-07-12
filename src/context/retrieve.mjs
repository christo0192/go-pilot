// Bounded lexical retrieval for the context plane.
//
// DEGRADE-SAFE (mirrors ../boundary/rtk-compress.mjs and cce-retrieve.mjs): the
// fast path shells out to ripgrep, but `rg` is NOT guaranteed to be a spawnable
// binary (it may be absent, or a shell function/alias — in which case
// spawnSync returns ENOENT). When rg cannot be executed we fall back to a
// bounded Node-fs walk so retrieval NEVER silently returns nothing. A missing
// tool must degrade, not disappear.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join, relative, sep } from "node:path";
import { estimateTokens } from "../boundary/guard.mjs";

const IGNORE_DIRS = new Set([".git", "node_modules", ".gopilot"]);
const IGNORE_REL_PREFIXES = ["deploy/mem0-src"];
const MAX_FILE_BYTES = 512 * 1024; // skip large/binary blobs in the fs fallback
const MAX_FS_SCAN = 20000; // hard cap on files inspected by the fallback

function terms(query) {
  return [...new Set(String(query).toLowerCase().match(/[a-z_][a-z0-9_-]{2,}/g) || [])].slice(0, 10);
}

// --- rg availability (cached, like rtk/cce) --------------------------------
let _rgAvailable;
export function _resetRgAvailability() {
  _rgAvailable = undefined;
}
function rgAvailable() {
  if (_rgAvailable !== undefined) return _rgAvailable;
  try {
    const r = spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 5000 });
    _rgAvailable = !r.error && r.status === 0;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
}

function rgSearch(term, cwd, limit) {
  const result = spawnSync(
    "rg",
    ["-i", "-l", "--hidden", "-g", "!.git", "-g", "!node_modules", "-g", "!deploy/mem0-src", term, "."],
    { cwd, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error) return null; // could not exec rg — signal caller to fall back
  return (result.stdout || "").split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")).slice(0, limit);
}

// Bounded, dependency-free content grep. Case-insensitive substring match on
// text files, honouring the same ignores as the rg path.
function fsSearch(term, cwd, limit) {
  const needle = term.toLowerCase();
  const out = [];
  let scanned = 0;
  const walk = (dir) => {
    if (out.length >= limit || scanned >= MAX_FS_SCAN) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit || scanned >= MAX_FS_SCAN) return;
      const full = join(dir, e.name);
      const rel = relative(cwd, full).split(sep).join("/");
      if (IGNORE_REL_PREFIXES.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        scanned += 1;
        let content;
        try {
          if (statSync(full).size > MAX_FILE_BYTES) continue;
          content = readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (content.toLowerCase().includes(needle)) out.push(rel);
      }
    }
  };
  walk(cwd);
  return out.slice(0, limit);
}

function search(term, cwd, limit, searcher) {
  if (typeof searcher === "function") return searcher(term, cwd, limit) || [];
  if (rgAvailable()) {
    const hits = rgSearch(term, cwd, limit);
    if (hits !== null) return hits;
  }
  return fsSearch(term, cwd, limit);
}

export function retrieveContext(query, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const maxFiles = opts.maxFiles ?? 12;
  const maxTokens = opts.maxTokens ?? 6000;
  const candidates = new Map();
  for (const term of terms(query)) {
    for (const file of search(term, cwd, maxFiles, opts.searcher)) {
      const entry = candidates.get(file) || { file, score: 0, terms: [] };
      entry.score += 1;
      entry.terms.push(term);
      candidates.set(file, entry);
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const selected = [];
  let usedTokens = 0;
  for (const hit of ranked) {
    if (selected.length >= maxFiles) break;
    let content;
    try {
      content = readFileSync(resolve(cwd, hit.file), "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n").slice(0, opts.maxLinesPerFile ?? 120).join("\n");
    const tokens = estimateTokens(lines);
    if (usedTokens + tokens > maxTokens) continue;
    selected.push({ ...hit, content: lines, tokens });
    usedTokens += tokens;
  }
  const text = selected.map((hit) => `### ${hit.file}\n${hit.content}`).join("\n\n");
  return { query, files: selected, text, tokens: usedTokens, candidateCount: ranked.length };
}
