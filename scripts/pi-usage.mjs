#!/usr/bin/env node
// Extract token usage for a just-finished agentic Pi worker run from Pi's
// session logs (~/.pi/agent/sessions/**/*.jsonl — each assistant message
// carries {usage:{input,output,reasoning,cacheRead,...}}). This closes the
// "agentic runs have usage:null" accounting hole: pi -p prints no usage, but
// the session file has it.
//
// Usage: node scripts/pi-usage.mjs <sinceEpochMs> <taskSnippet>
//   sinceEpochMs: only session files modified at/after this time are candidates
//   taskSnippet:  sanitized (alphanumeric+space) fragment of the task text used
//                 to pick OUR session among concurrent workers
// Prints one JSON line {in,out,reasoning,cacheRead,total,model,estimated:false}
// Exit 0 on success, 2 when no matching session found (caller logs usage:null).
// GOPILOT_SESSIONS_ROOT overrides the session dir (tests inject a fixture).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// Normalize BEFORE sanitizing: Pi stores the prompt in the session JSONL with
// newlines/tabs JSON-escaped (the 2-char sequences \n, \r, \t), which would
// sanitize to the letters n/r/t — but the caller's snippet comes from the raw
// prompt where real newlines become spaces. Collapse the escaped forms to spaces
// first so a multi-line prompt's snippet still matches (else recovery silently
// returns nothing whenever a newline lands in the snippet window).
export const sanitize = (s) => String(s ?? "").replace(/\\[nrt]/g, " ").replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ");

/** Recover usage for the newest session matching `snippet`, modified at/after
 *  `since`. Returns the usage object or null when no session matches. Pure over
 *  the filesystem so it is unit-testable via a fixture root. */
export function recoverUsage(since = 0, snippetRaw = "", root = defaultRoot()) {
  const snippet = sanitize(snippetRaw).trim().slice(0, 60);
  let dirs = [];
  try { dirs = readdirSync(root); } catch { return null; }
  const candidates = [];
  for (const d of dirs) {
    let files = [];
    try { files = readdirSync(join(root, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(root, d, f);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs >= since - 2000) candidates.push({ p, mtime: st.mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const { p } of candidates) {
    let raw;
    try { raw = readFileSync(p, "utf8"); } catch { continue; }
    if (snippet && !sanitize(raw).includes(snippet)) continue;
    const sum = { in: 0, out: 0, reasoning: 0, cacheRead: 0, total: 0 };
    let model = null;
    for (const line of raw.split("\n")) {
      if (!line.includes('"usage"')) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const msg = j.message ?? j;
      const u = msg.usage;
      if (!u || msg.role !== "assistant") continue;
      sum.in += u.input ?? 0;
      sum.out += u.output ?? 0;
      sum.reasoning += u.reasoning ?? 0;
      sum.cacheRead += u.cacheRead ?? 0;
      sum.total += u.totalTokens ?? 0;
      model = msg.model ?? model;
    }
    if (sum.total > 0 || sum.in + sum.out > 0) return { ...sum, model, estimated: false };
  }
  return null;
}

function defaultRoot() {
  return process.env.GOPILOT_SESSIONS_ROOT || join(homedir(), ".pi", "agent", "sessions");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = recoverUsage(Number(process.argv[2] ?? 0), process.argv[3] ?? "");
  if (res) { console.log(JSON.stringify(res)); process.exit(0); }
  process.exit(2);
}
