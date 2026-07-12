// Benchmark dispatcher for the live campaign (docs/live-test-plan.md).
//
// Frontier (Opus)  -> the REAL Claude CLI headless, low reasoning effort.
// Workhorse (Kimi/DeepSeek) -> direct OpenAI-compatible HTTP to the Ikey gateway,
//   with EXACT cost from /key/info.spend deltas (no pricing guesswork).
//
// Injected into runTask as opts.dispatch, so routing/compression/validation/
// metrics stay the real governed path. Zero external deps (node builtins + fetch).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveModel } from "../../src/config/governance.mjs";

const GATEWAY = "https://ikey-gateway.fly.dev";

function readKey() {
  const env = readFileSync(new URL("../../deploy/.env", import.meta.url), "utf8");
  const m = env.match(/^WORKHORSE_GATEWAY_KEY=(.+)$/m);
  if (!m) throw new Error("WORKHORSE_GATEWAY_KEY missing from deploy/.env");
  return m[1].trim();
}

async function keySpend(key) {
  const r = await fetch(`${GATEWAY}/key/info`, { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json();
  return typeof j?.info?.spend === "number" ? j.info.spend : null;
}

/**
 * @param {{key?:string, effort?:string, maxTokens?:number}} [opts]
 * @returns {(request:object)=>Promise<{result:{text:string}, usage:object}>}
 */
export function createBenchmarkDispatcher(opts = {}) {
  const key = opts.key || readKey();
  const effort = opts.effort || "low";
  const maxTokens = opts.maxTokens || 8000;

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

    // Workhorse: resolve alias -> gateway model id, POST, measure exact spend delta.
    const gatewayModel = resolveModel(request.model).version;
    const before = await keySpend(key);
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: gatewayModel,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.contract?.maxOutputTokens || maxTokens,
      }),
    });
    if (!res.ok) throw new Error(`gateway ${gatewayModel} HTTP ${res.status}: ${(await res.text()).slice(-400)}`);
    const j = await res.json();
    const after = await keySpend(key);
    const u = j.usage || {};
    const text = j.choices?.[0]?.message?.content ?? "";
    return {
      result: { text },
      usage: {
        model: gatewayModel,
        provider: "ikey-gateway",
        tokens: {
          input: u.prompt_tokens || 0,
          output: u.completion_tokens || 0,
          reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
          cached: u.prompt_tokens_details?.cached_tokens || 0,
          total: u.total_tokens || 0,
        },
        costUsd: before != null && after != null ? Math.max(0, after - before) : null,
        latencyMs: Date.now() - started,
        finishReason: j.choices?.[0]?.finish_reason,
      },
    };
  };
}
