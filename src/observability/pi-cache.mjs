import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function percent(cached, fresh) {
  return cached + fresh > 0 ? +(100 * cached / (cached + fresh)).toFixed(2) : null;
}

function assistantCalls(path) {
  let lines;
  try { lines = readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean); } catch { return []; }
  return lines.flatMap((line) => {
    let row;
    try { row = JSON.parse(line); } catch { return []; }
    const message = row.type === "message" ? row.message : null;
    if (message?.role !== "assistant" || !message.usage) return [];
    const fresh = Number(message.usage.input) || 0;
    const cached = Number(message.usage.cacheRead) || 0;
    const rawTs = message.timestamp ?? row.timestamp;
    const ts = typeof rawTs === "number" ? rawTs : Date.parse(rawTs || "");
    return [{
      fresh, cached, hitPct: percent(cached, fresh),
      model: message.model || "unknown", provider: message.provider || "unknown",
      ts: Number.isFinite(ts) ? ts : null, error: Boolean(message.errorMessage),
    }];
  });
}

export function analyzePiSessions(paths, opts = {}) {
  const maxFiles = opts.maxFiles ?? 50;
  const idleMinutes = opts.idleMinutes ?? 10;
  const files = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).flatMap((root) => {
    const found = [];
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try { found.push({ path, mtime: statSync(path).mtimeMs }); } catch { /* raced deletion */ }
        }
      }
    };
    walk(root);
    return found;
  }).sort((a, b) => b.mtime - a.mtime).slice(0, maxFiles);

  const calls = files.flatMap((file) => assistantCalls(file.path).map((call) => ({ ...call, file: file.path })))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const successful = calls.filter((call) => !call.error && call.fresh + call.cached > 0);
  const reasons = { firstCall: 0, modelSwitch: 0, idle: 0, largeFreshDelta: 0, unknown: 0 };
  const eligible = [];
  for (let i = 0; i < successful.length; i += 1) {
    const call = successful[i];
    const previous = successful[i - 1];
    const gapMinutes = previous?.ts && call.ts ? (call.ts - previous.ts) / 60000 : null;
    const sameSession = previous?.file === call.file;
    const sameModel = previous?.model === call.model && previous?.provider === call.provider;
    if (sameSession && sameModel && gapMinutes != null && gapMinutes <= idleMinutes && call.fresh < 4000) {
      eligible.push(call);
      continue;
    }
    if (!previous || !sameSession) reasons.firstCall += 1;
    else if (!sameModel) reasons.modelSwitch += 1;
    else if (gapMinutes > idleMinutes) reasons.idle += 1;
    else if (call.fresh >= 4000) reasons.largeFreshDelta += 1;
    else reasons.unknown += 1;
  }
  const sum = (list, key) => list.reduce((n, call) => n + call[key], 0);
  const cumulativeFresh = sum(successful, "fresh");
  const cumulativeCached = sum(successful, "cached");
  const latest = successful.at(-1) || null;
  return {
    files: files.length, calls: calls.length, successfulCalls: successful.length,
    cumulative: { fresh: cumulativeFresh, cached: cumulativeCached, hitPct: percent(cumulativeCached, cumulativeFresh) },
    latest: latest ? { model: latest.model, provider: latest.provider, fresh: latest.fresh, cached: latest.cached, hitPct: latest.hitPct } : null,
    eligibleWarm: {
      calls: eligible.length,
      hitPct: percent(sum(eligible, "cached"), sum(eligible, "fresh")),
      at98Pct: eligible.length ? +(100 * eligible.filter((call) => call.hitPct >= 98).length / eligible.length).toFixed(1) : null,
    },
    coldReasons: reasons,
  };
}
