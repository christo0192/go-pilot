// Bounded, chunk-level lexical retrieval for the context plane.
//
// Retrieval is intentionally zero-dependency and degrade-safe: ripgrep finds
// candidate files when available, with a bounded Node filesystem fallback.
// Only query-relevant chunks are injected. This avoids paying for the first
// 120 lines of every matching file and prevents identical chunks from entering
// the prompt through duplicate paths or generated copies.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join, relative, sep } from "node:path";
import { estimateTokens } from "../boundary/guard.mjs";

const IGNORE_DIRS = new Set([".git", "node_modules", ".gopilot"]);
const IGNORE_REL_PREFIXES = ["deploy/mem0-src"];
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FS_SCAN = 20000;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "can", "could", "does",
  "for", "from", "get", "have", "into", "make", "more", "please", "setup",
  "should", "that", "the", "their", "then", "this", "with", "would", "your",
]);

function terms(query) {
  return [...new Set(String(query).toLowerCase().match(/[a-z_][a-z0-9_-]{2,}/g) || [])]
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 12);
}

let _rgAvailable;
export function _resetRgAvailability() { _rgAvailable = undefined; }
function rgAvailable() {
  if (_rgAvailable !== undefined) return _rgAvailable;
  try {
    const r = spawnSync("rg", ["--version"], { encoding: "utf8", timeout: 5000 });
    _rgAvailable = !r.error && r.status === 0;
  } catch { _rgAvailable = false; }
  return _rgAvailable;
}

function rgSearch(term, cwd, limit) {
  const result = spawnSync("rg", [
    "-i", "-l", "--hidden", "-g", "!.git", "-g", "!node_modules",
    "-g", "!deploy/mem0-src", "--", term, ".",
  ], { cwd, encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) return null;
  return (result.stdout || "").split("\n").filter(Boolean)
    .map((file) => file.replace(/^\.\//, "")).slice(0, limit);
}

function fsSearch(term, cwd, limit) {
  const needle = term.toLowerCase();
  const out = [];
  let scanned = 0;
  const walk = (dir) => {
    if (out.length >= limit || scanned >= MAX_FS_SCAN) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= limit || scanned >= MAX_FS_SCAN) return;
      const full = join(dir, entry.name);
      const rel = relative(cwd, full).split(sep).join("/");
      if (IGNORE_REL_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        scanned += 1;
        try {
          if (statSync(full).size <= MAX_FILE_BYTES && readFileSync(full, "utf8").toLowerCase().includes(needle)) out.push(rel);
        } catch { /* unreadable/non-text file */ }
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

function canonicalFile(cwd, file) {
  try { return realpathSync(resolve(cwd, file)); } catch { return resolve(cwd, file); }
}

function contentHash(text) {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

function chunks(content, maxLines = 40) {
  const lines = content.split("\n");
  const boundaries = [0];
  for (let i = 1; i < lines.length; i += 1) {
    if (/^(#{1,6}\s|(?:export\s+)?(?:async\s+)?function\s|(?:export\s+)?class\s)/.test(lines[i])) boundaries.push(i);
  }
  boundaries.push(lines.length);
  const out = [];
  for (let b = 0; b < boundaries.length - 1; b += 1) {
    const start = boundaries[b];
    const end = boundaries[b + 1];
    for (let from = start; from < end; from += maxLines) {
      const to = Math.min(end, from + maxLines);
      const text = lines.slice(from, to).join("\n").trim();
      if (text) out.push({ startLine: from + 1, endLine: to, content: text });
    }
  }
  return out;
}

function scoreChunk(chunk, file, queryTerms, fileScore) {
  const body = chunk.content.toLowerCase();
  const path = file.toLowerCase();
  let score = Math.min(3, fileScore);
  const matchedTerms = [];
  for (const term of queryTerms) {
    const occurrences = body.split(term).length - 1;
    if (occurrences > 0) {
      matchedTerms.push(term);
      score += Math.min(3, occurrences);
    }
    if (path.includes(term)) score += 2;
  }
  return { score, matchedTerms };
}

export function retrieveContext(query, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const maxFiles = opts.maxFiles ?? 6;
  const maxTokens = opts.maxTokens ?? 2000;
  const maxChunkTokens = opts.maxChunkTokens ?? 500;
  const maxChunksPerFile = opts.maxChunksPerFile ?? 2;
  const minScore = opts.minScore ?? 2;
  const minQueryTerms = opts.minQueryTerms ?? 1;
  const queryTerms = terms(query);
  if (queryTerms.length < minQueryTerms || maxTokens === 0 || maxFiles === 0) {
    return { query, files: [], chunks: [], text: "", tokens: 0, candidateCount: 0, droppedDuplicates: 0 };
  }

  const candidates = new Map();
  const seenCanonical = new Set();
  for (const term of queryTerms) {
    for (const file of search(term, cwd, maxFiles * 3, opts.searcher)) {
      const canonical = canonicalFile(cwd, file);
      const key = seenCanonical.has(canonical) ? [...candidates.entries()].find(([, value]) => value.canonical === canonical)?.[0] : file;
      if (!key) continue;
      seenCanonical.add(canonical);
      const entry = candidates.get(key) || { file: key, canonical, score: 0, terms: [] };
      entry.score += 1;
      if (!entry.terms.includes(term)) entry.terms.push(term);
      candidates.set(key, entry);
    }
  }

  const rankedChunks = [];
  for (const candidate of candidates.values()) {
    let content;
    try {
      if (statSync(candidate.canonical).size > MAX_FILE_BYTES) continue;
      content = readFileSync(candidate.canonical, "utf8");
    } catch { continue; }
    for (const chunk of chunks(content, opts.maxLinesPerChunk ?? 40)) {
      const scored = scoreChunk(chunk, candidate.file, queryTerms, candidate.score);
      if (scored.score < minScore || scored.matchedTerms.length === 0) continue;
      let text = chunk.content;
      let tokens = estimateTokens(text);
      if (tokens > maxChunkTokens) {
        const charLimit = Math.max(1, maxChunkTokens * 4);
        text = text.slice(0, charLimit);
        tokens = estimateTokens(text);
      }
      rankedChunks.push({
        file: candidate.file, startLine: chunk.startLine, endLine: chunk.endLine,
        content: text, tokens, score: scored.score, terms: scored.matchedTerms,
      });
    }
  }
  rankedChunks.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine);

  const selected = [];
  const fileCounts = new Map();
  const selectedFiles = new Set();
  const hashes = new Set();
  let usedTokens = 0;
  let droppedDuplicates = 0;
  for (const chunk of rankedChunks) {
    if (!selectedFiles.has(chunk.file) && selectedFiles.size >= maxFiles) continue;
    if ((fileCounts.get(chunk.file) || 0) >= maxChunksPerFile) continue;
    const hash = contentHash(chunk.content);
    if (hashes.has(hash)) { droppedDuplicates += 1; continue; }
    if (usedTokens + chunk.tokens > maxTokens) continue;
    selected.push(chunk);
    hashes.add(hash);
    selectedFiles.add(chunk.file);
    fileCounts.set(chunk.file, (fileCounts.get(chunk.file) || 0) + 1);
    usedTokens += chunk.tokens;
  }

  const files = [...selectedFiles].map((file) => {
    const fileChunks = selected.filter((chunk) => chunk.file === file);
    return { file, score: Math.max(...fileChunks.map((chunk) => chunk.score)), tokens: fileChunks.reduce((n, chunk) => n + chunk.tokens, 0) };
  });
  const text = selected.map((chunk) => `### ${chunk.file}:${chunk.startLine}\n${chunk.content}`).join("\n\n");
  return { query, files, chunks: selected, text, tokens: usedTokens, candidateCount: candidates.size, droppedDuplicates };
}
