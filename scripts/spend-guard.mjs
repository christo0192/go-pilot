#!/usr/bin/env node
// Budget guard: check SETTLED cumulative gateway spend against the cap before
// delegating (gateway spend settles async — never trust per-call deltas, D-S11).
// Cached to avoid an extra HTTP round-trip per delegation.
//
// Usage: node scripts/spend-guard.mjs [--cache file] [--ttl 300] [--cap 7]
// Prints {ok, spend, cap, cached}. Exit: 0 under cap · 7 over cap · 4 infra error
// (caller decides: fail-open on infra, fail-CLOSED on real over-budget).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BASE = (process.env.WORKHORSE_GATEWAY_URL || "https://ikey-gateway.fly.dev").replace(/\/v1\/?$/, "");

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i]?.replace(/^--/, "")] = args[i + 1];
const cap = Number(opt.cap ?? process.env.GOPILOT_SPEND_CAP_USD ?? 7);
const ttlMs = Number(opt.ttl ?? 300) * 1000;
const cacheFile = opt.cache ?? resolve(ROOT, "scripts/baseline-rig/out/spend-cache.json");

function loadKey() {
  if (process.env.WORKHORSE_GATEWAY_KEY) return process.env.WORKHORSE_GATEWAY_KEY;
  const env = readFileSync(resolve(ROOT, "deploy/.env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*WORKHORSE_GATEWAY_KEY\s*=\s*(.+)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }
  throw new Error("no key");
}

function emit(res, code) { console.log(JSON.stringify(res)); process.exit(code); }

// Fresh cache? Use it (still enforce the cap on the cached value).
try {
  const c = JSON.parse(readFileSync(cacheFile, "utf8"));
  if (Date.now() - c.ts < ttlMs && typeof c.spend === "number") {
    emit({ ok: c.spend < cap, spend: c.spend, cap, cached: true }, c.spend < cap ? 0 : 7);
  }
} catch { /* no/stale cache */ }

let spend;
try {
  const res = await fetch(`${BASE}/key/info`, {
    headers: { authorization: `Bearer ${loadKey()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  spend = Number(j?.info?.spend ?? j?.spend);
  if (!Number.isFinite(spend)) throw new Error("no spend field");
} catch (e) {
  emit({ ok: null, error: e.message, cap }, 4);
}
try {
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ ts: Date.now(), spend }));
} catch { /* cache write is best-effort */ }
emit({ ok: spend < cap, spend, cap, cached: false }, spend < cap ? 0 : 7);
