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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const since = Number(process.argv[2] ?? 0);
const snippet = (process.argv[3] ?? "").replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const ROOT = join(homedir(), ".pi", "agent", "sessions");

const sanitize = (s) => s.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ");

let candidates = [];
let dirs = [];
try { dirs = readdirSync(ROOT); } catch { process.exit(2); }
for (const d of dirs) {
  let files = [];
  try { files = readdirSync(join(ROOT, d)); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(ROOT, d, f);
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
  if (sum.total > 0 || sum.in + sum.out > 0) {
    console.log(JSON.stringify({ ...sum, model, estimated: false }));
    process.exit(0);
  }
}
process.exit(2);
