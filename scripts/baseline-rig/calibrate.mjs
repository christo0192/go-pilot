// Calibration probe (docs/live-test-plan.md §8, handover A4).
//
// Resolves the ONE open cost question: is gateway /key/info.spend synchronous or
// async/batched? Makes a serial live call to each workhorse model, then POLLS
// cumulative spend until it stops moving, logging the settling curve. From the
// settled per-model delta + reported token usage it derives an effective
// $/total-token and $/output-token rate used by the cost model for per-model
// attribution.
//
// Serial by construction so each spend delta attributes to exactly one model.
// Zero external deps (node builtins + fetch). Writes a JSON report to stdout.

import { readFileSync } from "node:fs";
import { resolveModel } from "../../src/config/governance.mjs";

const GATEWAY = "https://ikey-gateway.fly.dev";
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 30000;
const STABLE_READS = 3; // spend considered settled after N identical consecutive reads

function readKey() {
  const env = readFileSync(new URL("../../deploy/.env", import.meta.url), "utf8");
  const m = env.match(/^WORKHORSE_GATEWAY_KEY=(.+)$/m);
  if (!m) throw new Error("WORKHORSE_GATEWAY_KEY missing from deploy/.env");
  return m[1].trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function keySpend(key) {
  const r = await fetch(`${GATEWAY}/key/info`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`/key/info HTTP ${r.status}`);
  const j = await r.json();
  return typeof j?.info?.spend === "number" ? j.info.spend : null;
}

// Poll until spend is unchanged for STABLE_READS consecutive reads or POLL_MAX_MS
// elapses. Returns { settled, curve:[{tMs,spend}], stable:boolean }.
async function pollUntilSettled(key, baseline) {
  const curve = [];
  const t0 = Date.now();
  let lastVals = [];
  while (Date.now() - t0 < POLL_MAX_MS) {
    const spend = await keySpend(key);
    const tMs = Date.now() - t0;
    curve.push({ tMs, spend });
    lastVals.push(spend);
    if (lastVals.length > STABLE_READS) lastVals.shift();
    const settledNow =
      lastVals.length === STABLE_READS &&
      lastVals.every((v) => v === lastVals[0]) &&
      lastVals[0] !== baseline; // require it to have actually moved off baseline
    if (settledNow) return { settled: lastVals[0], curve, stable: true };
    await sleep(POLL_INTERVAL_MS);
  }
  const last = curve.length ? curve[curve.length - 1].spend : baseline;
  return { settled: last, curve, stable: false };
}

async function callModel(key, alias, prompt, maxTokens) {
  const gatewayModel = resolveModel(alias).version;
  const started = Date.now();
  const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: gatewayModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`gateway ${gatewayModel} HTTP ${res.status}: ${(await res.text()).slice(-300)}`);
  const j = await res.json();
  const u = j.usage || {};
  return {
    alias,
    gatewayModel,
    latencyMs: Date.now() - started,
    finishReason: j.choices?.[0]?.finish_reason,
    contentChars: (j.choices?.[0]?.message?.content || "").length,
    tokens: {
      input: u.prompt_tokens || 0,
      output: u.completion_tokens || 0,
      reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
      cached: u.prompt_tokens_details?.cached_tokens || 0,
      total: u.total_tokens || 0,
    },
  };
}

async function main() {
  const key = readKey();
  const prompt =
    "Explain, in about 150 words, why unit tests are valuable in software engineering. " +
    "Cover regression safety, documentation, and design pressure.";
  const models = ["kimi-ikey", "deepseek-ikey"];
  const report = { probedAt: new Date().toISOString(), gateway: GATEWAY, results: [] };

  const startSpend = await keySpend(key);
  process.stderr.write(`baseline cumulative spend: ${startSpend}\n`);
  report.baselineSpend = startSpend;

  let prevSpend = startSpend;
  for (const alias of models) {
    process.stderr.write(`\n--- ${alias} ---\n`);
    const call = await callModel(key, alias, prompt, 4000);
    process.stderr.write(
      `usage: total=${call.tokens.total} out=${call.tokens.output} reasoning=${call.tokens.reasoning} finish=${call.finishReason} chars=${call.contentChars}\n`,
    );
    const settleResult = await pollUntilSettled(key, prevSpend);
    const delta = settleResult.settled != null && prevSpend != null ? settleResult.settled - prevSpend : null;
    process.stderr.write(
      `spend curve: ${settleResult.curve.map((c) => `${c.tMs}ms=${c.spend}`).join("  ")}\n` +
        `settled delta: ${delta} (stable=${settleResult.stable})\n`,
    );
    const rates =
      delta != null && delta > 0
        ? {
            perTotalToken: call.tokens.total ? delta / call.tokens.total : null,
            perOutputToken: call.tokens.output ? delta / call.tokens.output : null,
            perMillionTotal: call.tokens.total ? (delta / call.tokens.total) * 1e6 : null,
          }
        : null;
    report.results.push({ ...call, spendBefore: prevSpend, spendAfter: settleResult.settled, settledDelta: delta, stable: settleResult.stable, rates, curve: settleResult.curve });
    if (settleResult.settled != null) prevSpend = settleResult.settled;
  }

  report.finalSpend = prevSpend;
  report.totalDelta = prevSpend != null && startSpend != null ? prevSpend - startSpend : null;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`calibration failed: ${e.stack || e.message}\n`);
  process.exit(1);
});
