#!/usr/bin/env node
// verify-litellm.mjs — Step 2.1 "done-when" checker for the workhorse gateway.
// =============================================================================
// Zero dependencies (Node built-in fetch). Reads LITELLM_BASE_URL +
// LITELLM_MASTER_KEY from the environment, asks the LiteLLM proxy what models it
// loaded (GET /v1/models), then fires a tiny "say OK" chat completion at each and
// prints a PASS / FAIL / SKIP(no key) table.
//
// ACTIVATE-BY-KEY: a model whose provider key is unset can't authenticate. That
// is EXPECTED, not an error — it is reported SKIP, and the script still exits 0
// as long as the gateway itself is reachable. A non-empty FAIL count (a model
// erroring for a NON-auth reason) is the only thing that exits non-zero.
//
// Run:  node scripts/verify-litellm.mjs
//   env LITELLM_BASE_URL   (default http://localhost:4000)
//       LITELLM_MASTER_KEY (default sk-gopilot-dev — the dev default)
// =============================================================================

const BASE = (process.env.LITELLM_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const KEY = process.env.LITELLM_MASTER_KEY || "sk-gopilot-dev";
const AUTH = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const TIMEOUT_MS = 30_000;

// Heuristic: does this error read like "no/invalid provider key" (=> SKIP) rather
// than a genuine failure (=> FAIL)? LiteLLM surfaces the upstream auth message.
const AUTH_HINT =
  /api[_ -]?key|authenticat|unauthor|401|403|no api key|invalid key|environment variable|not set|missing|credential|no deployments available|forbidden/i;

async function withTimeout(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkGatewayUp() {
  // Liveliness needs no auth; if this is unreachable the proxy is down.
  try {
    const r = await withTimeout(`${BASE}/health/liveliness`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

async function listModels() {
  const r = await withTimeout(`${BASE}/v1/models`, { headers: AUTH });
  if (!r.ok) {
    throw new Error(`GET /v1/models -> HTTP ${r.status} ${r.statusText}`);
  }
  const body = await r.json();
  // OpenAI shape: { data: [ { id, ... } ] }
  return (body.data || []).map((m) => m.id).filter(Boolean).sort();
}

async function probe(model) {
  // Tiny, cheap completion. Any 2xx = PASS. Auth-shaped error = SKIP. Else FAIL.
  let r;
  try {
    r = await withTimeout(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "say OK" }],
        max_tokens: 5,
        temperature: 0,
      }),
    });
  } catch (err) {
    const msg = String(err && err.message);
    return { status: AUTH_HINT.test(msg) ? "SKIP" : "FAIL", detail: msg };
  }
  if (r.ok) return { status: "PASS", detail: `HTTP ${r.status}` };
  const text = await r.text().catch(() => "");
  const detail = `HTTP ${r.status} ${text.slice(0, 160).replace(/\s+/g, " ")}`;
  // 401/403, or a body mentioning missing/invalid key => provider not activated.
  const looksAuth = r.status === 401 || r.status === 403 || AUTH_HINT.test(text);
  return { status: looksAuth ? "SKIP" : "FAIL", detail };
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  console.log(`workhorse gateway: ${BASE}`);

  if (!(await checkGatewayUp())) {
    console.error(
      `FATAL: LiteLLM not reachable at ${BASE}/health/liveliness\n` +
        `  Start it:  cd deploy && docker compose up -d litellm`
    );
    process.exit(2);
  }
  console.log("gateway health: UP (/health/liveliness)\n");

  let models;
  try {
    models = await listModels();
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(2);
  }

  if (models.length === 0) {
    console.log(
      "No models loaded. Expected when NO provider keys are set — the gateway is\n" +
        "up and the verifier works; set OPENROUTER_API_KEY (or a direct vendor key)\n" +
        "in deploy/.env and re-run to exercise live routing."
    );
    process.exit(0);
  }

  console.log(`Probing ${models.length} model(s) with a "say OK" completion:\n`);
  console.log(`  ${pad("STATUS", 6)}  ${pad("MODEL", 18)}  DETAIL`);
  console.log(`  ${"-".repeat(6)}  ${"-".repeat(18)}  ${"-".repeat(40)}`);

  const tally = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const model of models) {
    const { status, detail } = await probe(model);
    tally[status] += 1;
    console.log(`  ${pad(status, 6)}  ${pad(model, 18)}  ${detail}`);
  }

  console.log(
    `\nSummary: ${tally.PASS} PASS · ${tally.SKIP} SKIP(no key) · ${tally.FAIL} FAIL` +
      ` (of ${models.length})`
  );
  if (tally.PASS === 0) {
    console.log(
      "0 working models — expected with no provider keys. Add a key in deploy/.env\n" +
        "(OPENROUTER_API_KEY reaches all models) and re-run to see PASS rows."
    );
  }
  // Only a genuine (non-auth) failure is a hard error.
  process.exit(tally.FAIL > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`FATAL: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
});
