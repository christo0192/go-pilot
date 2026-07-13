#!/usr/bin/env node
// Circuit breaker decision for a workhorse model, computed from the delegate
// metrics ledger: N consecutive failed attempts within the window ⇒ breaker
// OPEN until <last failure + cooloff>. Stateless — the ledger IS the state.
//
// Usage: node scripts/breaker-check.mjs <model> [--log file] [--n 3]
//        [--window-min 10] [--cooloff-min 5] [--now epochMs (tests)]
// Prints {open, failures, until?}. Exit: 0 closed · 6 open · 0 on missing log.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const model = process.argv[2];
const args = process.argv.slice(3);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i]?.replace(/^--/, "")] = args[i + 1];
const N = Number(opt.n ?? 3);
const windowMs = Number(opt["window-min"] ?? 10) * 60_000;
const cooloffMs = Number(opt["cooloff-min"] ?? 5) * 60_000;
const now = Number(opt.now ?? Date.now());
const logFile = opt.log ?? resolve(HERE, "baseline-rig/out/delegate-log.jsonl");

function emit(res, code) { console.log(JSON.stringify(res)); process.exit(code); }
if (!model) emit({ open: false, error: "no model given" }, 0);

let lines = [];
try { lines = readFileSync(logFile, "utf8").trim().split("\n"); } catch { emit({ open: false, failures: 0 }, 0); }

const entries = [];
for (const line of lines) {
  try {
    const j = JSON.parse(line);
    if (j.model === model) entries.push(j);
  } catch { /* skip bad line */ }
}
const lastN = entries.slice(-N);
if (lastN.length < N) emit({ open: false, failures: lastN.filter((e) => e.outcome !== "ok").length }, 0);

const allFailed = lastN.every((e) => e.outcome !== "ok");
const ts = (e) => Date.parse(e.ts);
const withinWindow = ts(lastN[lastN.length - 1]) - ts(lastN[0]) <= windowMs;
const until = ts(lastN[lastN.length - 1]) + cooloffMs;

if (allFailed && withinWindow && now < until) {
  emit({ open: true, failures: N, until: new Date(until).toISOString() }, 6);
}
emit({ open: false, failures: lastN.filter((e) => e.outcome !== "ok").length }, 0);
