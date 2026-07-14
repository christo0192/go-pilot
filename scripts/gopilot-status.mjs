#!/usr/bin/env node
// gopilot-status — the single pane of glass for the rig.
// Reports: gateway health + settled spend vs cap · delegate ledger stats
// (per-model latency p50/p95, failure/repair/escalation rates, token totals) ·
// circuit-breaker states · leaked worker panes · Mem0 health.
// Usage: node scripts/gopilot-status.mjs [--json] [--hours 24]
// Zero deps. Never prints secrets.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const hours = Number(args[args.indexOf("--hours") + 1] || 24);
const GW = (process.env.WORKHORSE_GATEWAY_URL || "https://ikey-gateway.fly.dev").replace(/\/v1\/?$/, "");
const CAP = Number(process.env.GOPILOT_SPEND_CAP_USD ?? 7);

function loadKey() {
  if (process.env.WORKHORSE_GATEWAY_KEY) return process.env.WORKHORSE_GATEWAY_KEY;
  const env = readFileSync(resolve(ROOT, "deploy/.env"), "utf8");
  const m = env.match(/^WORKHORSE_GATEWAY_KEY=(.+)$/m);
  if (!m) throw new Error("no key");
  return m[1].trim();
}

const pctl = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);

const status = { generatedAt: new Date().toISOString(), windowHours: hours };

// --- Gateway health + settled spend -----------------------------------------
try {
  const t0 = Date.now();
  const res = await fetch(`${GW}/key/info`, { headers: { authorization: `Bearer ${loadKey()}` }, signal: AbortSignal.timeout(10_000) });
  const j = await res.json();
  const spend = Number(j?.info?.spend ?? NaN);
  status.gateway = { ok: res.ok, latencyMs: Date.now() - t0, settledSpendUsd: spend, capUsd: CAP, capUsedPct: Number.isFinite(spend) ? +(100 * spend / CAP).toFixed(1) : null };
} catch (e) {
  status.gateway = { ok: false, error: e.message };
}

// --- Delegate ledger stats ---------------------------------------------------
const ledgerPath = resolve(ROOT, "scripts/baseline-rig/out/delegate-log.jsonl");
status.delegations = { ledger: existsSync(ledgerPath) ? "present" : "missing", models: {} };
if (existsSync(ledgerPath)) {
  const since = Date.now() - hours * 3600_000;
  const entries = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && Date.parse(e.ts) >= since);
  status.delegations.attempts = entries.length;
  for (const model of [...new Set(entries.map((e) => e.model))]) {
    const ms = entries.filter((e) => e.model === model);
    const lat = ms.map((e) => e.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
    const fails = ms.filter((e) => e.outcome !== "ok").length;
    status.delegations.models[model] = {
      attempts: ms.length,
      okRate: ms.length ? +((ms.length - fails) / ms.length).toFixed(3) : null,
      repairAttempts: ms.filter((e) => e.attempt > 1).length,
      latencyMs: { p50: pctl(lat, 0.5), p95: pctl(lat, 0.95) },
      tokens: {
        in: ms.reduce((a, e) => a + (e.usage?.in || 0), 0),
        out: ms.reduce((a, e) => a + (e.usage?.out || 0), 0),
        reasoning: ms.reduce((a, e) => a + (e.usage?.reasoning || 0), 0),
        // raw path logs `cached`, agentic path logs `cacheRead` — same thing
        cached: ms.reduce((a, e) => a + (e.usage?.cached || e.usage?.cacheRead || 0), 0),
      },
      routingOverrides: ms.filter((e) => e.suggested && e.suggested !== e.model).length,
    };
  }
}

// --- Breaker states ----------------------------------------------------------
status.breakers = {};
for (const model of ["deepseek", "kimi"]) {
  try {
    const out = execFileSync("node", [resolve(ROOT, "scripts/breaker-check.mjs"), model], { encoding: "utf8" });
    status.breakers[model] = JSON.parse(out.trim());
  } catch (e) {
    // exit 6 = open; stdout still carries the JSON
    try { status.breakers[model] = JSON.parse(String(e.stdout).trim()); } catch { status.breakers[model] = { error: "check failed" }; }
  }
}

// --- Leaked worker panes -----------------------------------------------------
try {
  const out = execFileSync("herdr", ["pane", "list"], { encoding: "utf8", timeout: 5000 });
  const leaked = out.split("\n").filter((l) => l.includes("wk:")).length;
  status.panes = { leakedWorkers: leaked };
} catch {
  status.panes = { leakedWorkers: null, note: "herdr not reachable (server down is fine when idle)" };
}

// --- Mem0 --------------------------------------------------------------------
try {
  const base = process.env.MEM0_BASE_URL || "http://localhost:8888";
  const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => fetch(base, { signal: AbortSignal.timeout(3000) }));
  status.mem0 = { ok: res.ok };
} catch {
  status.mem0 = { ok: false, note: "not running (optional service)" };
}

// --- Output ------------------------------------------------------------------
if (asJson) {
  console.log(JSON.stringify(status, null, 2));
} else {
  const g = status.gateway;
  console.log(`gopilot status — last ${hours}h (${status.generatedAt})`);
  console.log(`  gateway   ${g.ok ? "UP" : "DOWN"}${g.ok ? ` ${g.latencyMs}ms · settled $${g.settledSpendUsd?.toFixed(4)} / cap $${g.capUsd} (${g.capUsedPct}%)` : ` (${g.error})`}`);
  const d = status.delegations;
  console.log(`  delegates ${d.attempts ?? 0} attempts`);
  for (const [m, s] of Object.entries(d.models)) {
    const hitPct = s.tokens.in + s.tokens.cached > 0 ? ((100 * s.tokens.cached) / (s.tokens.in + s.tokens.cached)).toFixed(1) : "0.0";
    console.log(`    ${m.padEnd(9)} ok ${(s.okRate * 100).toFixed(1)}% · p50 ${s.latencyMs.p50}ms p95 ${s.latencyMs.p95}ms · repairs ${s.repairAttempts} · tok in/out/reason/cached ${s.tokens.in}/${s.tokens.out}/${s.tokens.reasoning}/${s.tokens.cached} (cache hit ${hitPct}%)${s.routingOverrides ? ` · overrides ${s.routingOverrides}` : ""}`);
  }
  for (const [m, b] of Object.entries(status.breakers)) {
    console.log(`  breaker   ${m}: ${b.open ? `OPEN until ${b.until}` : "closed"}`);
  }
  console.log(`  panes     leaked workers: ${status.panes.leakedWorkers ?? "n/a"}`);
  console.log(`  mem0      ${status.mem0.ok ? "UP" : "down/optional"}`);
}
