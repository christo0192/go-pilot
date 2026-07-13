#!/usr/bin/env node
// gateway-call.mjs — one-shot NON-AGENTIC workhorse call to the Ikey gateway.
// Unlike a Pi agent run, this surfaces exact token usage (incl. reasoning tokens),
// which `pi -p` does not. Used by pi-delegate.sh --raw and directly by the
// orchestrator for draft/answer subtasks that need no tools.
//
// Usage:
//   node scripts/gateway-call.mjs <alias|model-id> [--max-tokens N] [--timeout S] [--json] [prompt ...]
//   echo "prompt" | node scripts/gateway-call.mjs deepseek --json -
//
// Output: reply content on stdout; with --json a single JSON object:
//   { ok, content, model, latencyMs, finishReason, usage:{in,out,reasoning} }
// Exit codes: 0 ok · 2 empty content · 4 http/network error · 5 truncated (finish_reason=length)
// Zero deps (node:* + fetch). Key from WORKHORSE_GATEWAY_KEY or gitignored deploy/.env.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// WORKHORSE_GATEWAY_URL overrides the gateway (other deployments; fault-injection tests).
const GW_BASE = (process.env.WORKHORSE_GATEWAY_URL || 'https://ikey-gateway.fly.dev').replace(/\/v1\/?$/, '');
const ENDPOINT = `${GW_BASE}/v1/chat/completions`;
const ALIASES = { kimi: 'test/kimi-k2.6', deepseek: 'test/deepseek-v4-pro' };

function loadKey() {
  if (process.env.WORKHORSE_GATEWAY_KEY) return process.env.WORKHORSE_GATEWAY_KEY;
  const env = readFileSync(resolve(ROOT, 'deploy/.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*WORKHORSE_GATEWAY_KEY\s*=\s*(.+)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  throw new Error('WORKHORSE_GATEWAY_KEY not found in env or deploy/.env');
}

const args = process.argv.slice(2);
let modelArg = '', maxTokens = 8000, timeoutS = 240, asJson = false;
const promptParts = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--max-tokens') maxTokens = Number(args[++i]);
  else if (a === '--timeout') timeoutS = Number(args[++i]);
  else if (a === '--json') asJson = true;
  else if (!modelArg) modelArg = a;
  else promptParts.push(a);
}
if (!modelArg) {
  console.error('usage: gateway-call.mjs <alias|model-id> [--max-tokens N] [--timeout S] [--json] [prompt|-]');
  process.exit(4);
}
// Accept: alias · gateway id (test/...) · Pi-style id (ikey/test/...)
const model = ALIASES[modelArg.toLowerCase()] ?? modelArg.replace(/^ikey\//, '');

let prompt = promptParts.join(' ').trim();
if (!prompt || prompt === '-') prompt = readFileSync(0, 'utf8').trim();
if (!prompt) { console.error('[gateway-call] empty prompt'); process.exit(4); }

function emit(res, code) {
  if (asJson) process.stdout.write(JSON.stringify(res) + '\n');
  else process.stdout.write((res.content || res.error || '') + '\n');
  process.exit(code);
}

const t0 = Date.now();
let resp, body;
try {
  resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${loadKey()}` },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeoutS * 1000),
  });
  body = await resp.json().catch(() => null);
} catch (e) {
  emit({ ok: false, model, latencyMs: Date.now() - t0, error: `[network/timeout] ${e.message}` }, 4);
}
const latencyMs = Date.now() - t0;
if (!resp.ok || !body) {
  emit({ ok: false, model, latencyMs, error: `[HTTP ${resp.status}] ${JSON.stringify(body)?.slice(0, 300) ?? ''}` }, 4);
}
const choice = body.choices?.[0] ?? {};
const content = (choice.message?.content ?? '').trim();
const finishReason = choice.finish_reason ?? null;
const u = body.usage ?? {};
const usage = {
  in: u.prompt_tokens ?? null,
  out: u.completion_tokens ?? null,
  reasoning: u.completion_tokens_details?.reasoning_tokens ?? null,
};
const res = { ok: true, content, model, latencyMs, finishReason, usage };
if (!content) { res.ok = false; emit(res, 2); }
if (finishReason === 'length') { res.ok = false; emit(res, 5); }
emit(res, 0);
