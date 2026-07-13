#!/usr/bin/env node
// chat-repl.mjs — minimal interactive client for one gateway model.
// Usage:
//   node chat-repl.mjs <alias>                 # interactive REPL (reads stdin lines)
//   node chat-repl.mjs <alias> "one-shot msg"  # single prompt, prints reply, exits
// Zero deps (node:* + global fetch only). Loads WORKHORSE_GATEWAY_KEY from deploy/.env.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ENDPOINT = 'https://ikey-gateway.fly.dev/v1/chat/completions';
const MODELS = { kimi: 'test/kimi-k2.6', deepseek: 'test/deepseek-v4-pro' };

function loadKey() {
  if (process.env.WORKHORSE_GATEWAY_KEY) return process.env.WORKHORSE_GATEWAY_KEY;
  const env = readFileSync(resolve(ROOT, 'deploy/.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*WORKHORSE_GATEWAY_KEY\s*=\s*(.+)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '').trim();
  }
  throw new Error('WORKHORSE_GATEWAY_KEY not found in env or deploy/.env');
}

const alias = (process.argv[2] || '').toLowerCase();
const model = MODELS[alias];
if (!model) {
  console.error(`unknown alias "${alias}". use one of: ${Object.keys(MODELS).join(', ')}`);
  process.exit(1);
}
const KEY = loadKey();
const NAME = alias.toUpperCase();

async function ask(prompt) {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return `[${NAME} HTTP ${res.status}] ${body.slice(0, 300)}`;
  }
  const json = await res.json();
  const msg = json?.choices?.[0]?.message?.content?.trim() || '[empty content]';
  const u = json?.usage || {};
  return `${msg}\n  — ${NAME} (${model}) ${dt}s | in ${u.prompt_tokens ?? '?'} / out ${u.completion_tokens ?? '?'} tok`;
}

const oneShot = process.argv.slice(3).join(' ').trim();
if (oneShot) {
  console.log(await ask(oneShot));
  process.exit(0);
}

// REPL mode
process.stdout.write(`[${NAME}] ready — model ${model}. Type a message and press Enter.\n> `);
const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  const text = line.trim();
  if (!text) { process.stdout.write('> '); continue; }
  if (text === '/quit' || text === '/exit') break;
  process.stdout.write(`\n[${NAME} thinking…]\n`);
  try {
    process.stdout.write((await ask(text)) + '\n\n> ');
  } catch (e) {
    process.stdout.write(`[${NAME} error] ${e.message}\n\n> `);
  }
}
