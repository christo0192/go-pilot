// Benchmark dispatcher for the live campaign (docs/live-test-plan.md).
//
// Frontier (Opus)  -> the REAL Claude CLI headless, low reasoning effort.
// Workhorse (Kimi/DeepSeek) -> direct OpenAI-compatible HTTP to the Ikey gateway.
//
// Cost: the gateway's /key/info.spend is async/batched (calibrate.mjs showed a
// 2-7s settle lag), so a per-call before/after read is unreliable. We therefore
// attach a CALIBRATED estimate (rate x tokens) as costUsd here for immediate
// budget accounting; the campaign reconciles the grand total against the settled
// cumulative spend at the end (see cost-model.mjs).
//
// Injected into runTask as opts.dispatch (Arm A), or called directly for the
// naive arms (B/C). request.settings (temperature/top_p/max_tokens) is forwarded
// to the gateway. Zero external deps (node builtins + fetch).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveModel } from "../../src/config/governance.mjs";
import { estimateCallCost } from "../../src/metrics/cost-model.mjs";

const GATEWAY = "https://ikey-gateway.fly.dev";

function readKey() {
  const env = readFileSync(new URL("../../deploy/.env", import.meta.url), "utf8");
  const m = env.match(/^WORKHORSE_GATEWAY_KEY=(.+)$/m);
  if (!m) throw new Error("WORKHORSE_GATEWAY_KEY missing from deploy/.env");
  return m[1].trim();
}

const CALIBRATION = JSON.parse(readFileSync(new URL("./calibration.json", import.meta.url), "utf8"));

/**
 * @param {{key?:string, effort?:string, maxTokens?:number, rates?:object}} [opts]
 * @returns {(request:object)=>Promise<{result:{text:string}, usage:object}>}
 */
export function createBenchmarkDispatcher(opts = {}) {
  const key = opts.key || readKey();
  const effort = opts.effort || "low";
  const maxTokens = opts.maxTokens || 8000;
  const rates = opts.rates || CALIBRATION.rates;

  return async function dispatch(request) {
    const started = Date.now();

    if (request.plane === "frontier") {
      const r = spawnSync(
        "claude",
        ["-p", "--model", request.model, "--effort", effort, "--output-format", "json"],
        { input: request.prompt, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 },
      );
      if (r.status !== 0) throw new Error(`claude exited ${r.status}: ${(r.stderr || "").slice(-400)}`);
      const d = JSON.parse(r.stdout);
      const u = d.usage || {};
      return {
        result: { text: d.result || "" },
        usage: {
          model: request.model,
          provider: "anthropic-cli",
          tokens: {
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cacheWrite: u.cache_creation_input_tokens || 0,
            total: (u.input_tokens || 0) + (u.output_tokens || 0),
          },
          costUsd: typeof d.total_cost_usd === "number" ? d.total_cost_usd : 0,
          latencyMs: Date.now() - started,
        },
      };
    }

    // Workhorse: resolve alias -> gateway model id, forward settings, POST.
    const gatewayModel = resolveModel(request.model).version;
    const s = request.settings || {};
    const body = {
      model: gatewayModel,
      messages: [{ role: "user", content: request.prompt }],
      max_tokens: request.contract?.maxOutputTokens || s.max_tokens || maxTokens,
    };
    if (Number.isFinite(s.temperature)) body.temperature = s.temperature;
    if (Number.isFinite(s.top_p)) body.top_p = s.top_p;
    // Model-specific parameter constraints. Kimi (Moonshot) rejects any top_p
    // other than 0.95 with a hard 400 — coerce so a stray value never aborts a run.
    if (/kimi/i.test(gatewayModel) && body.top_p != null && body.top_p !== 0.95) body.top_p = 0.95;
    // Kimi K3 rejects any temperature != 1 with a hard 400 (verified). The
    // fixtures request temperature 0 for determinism; coerce to 1 for K3 only so
    // the swap never aborts a run (K2.6 keeps its requested temperature).
    if (/kimi-k3/i.test(gatewayModel)) body.temperature = 1;
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // 300s default: reasoning models (Kimi K2.5/K3) hit 180-200s on hard
      // fixtures, so the old 200s cap aborted valid slow calls. Callers can still
      // pass a shorter/longer request.signal.
      signal: request.signal || AbortSignal.timeout(300000),
    });
    if (!res.ok) throw new Error(`gateway ${gatewayModel} HTTP ${res.status}: ${(await res.text()).slice(-400)}`);
    const j = await res.json();
    const u = j.usage || {};
    const text = j.choices?.[0]?.message?.content ?? "";
    const tokens = {
      input: u.prompt_tokens || 0,
      output: u.completion_tokens || 0,
      reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
      cached: u.prompt_tokens_details?.cached_tokens || 0,
      total: u.total_tokens || 0,
    };
    return {
      result: { text },
      usage: {
        model: gatewayModel,
        provider: "ikey-gateway",
        tokens,
        costUsd: estimateCallCost(gatewayModel, tokens, rates),
        estCostUsd: estimateCallCost(gatewayModel, tokens, rates),
        latencyMs: Date.now() - started,
        finishReason: j.choices?.[0]?.finish_reason,
      },
    };
  };
}

/** Read the gateway's current cumulative spend (for baseline/settle reads). */
export async function readGatewaySpend(key = readKey()) {
  const r = await fetch(`${GATEWAY}/key/info`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`/key/info HTTP ${r.status}`);
  const j = await r.json();
  return typeof j?.info?.spend === "number" ? j.info.spend : null;
}

export { GATEWAY, readKey };
