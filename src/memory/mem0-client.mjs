// Real Mem0 HTTP client — a DROP-IN for the mock in mem0-adapter.mjs.
//
// It implements the SAME Tier-2 contract as createMockMem0():
//
//   add(memory)          -> stored memory (with its id)
//   search(query, topK)  -> Array<{ memory, score }>, length <= topK,
//                           highest score first; [] on empty/no-match
//
// Difference from the mock: this talks HTTP to a self-hosted Mem0 OSS REST
// server (mem0ai/mem0 `server/`). The endpoints/shapes below are documented in
// mem0-client.README.md WITH their source URLs — re-verify against the running
// server once Docker is up (see deploy/docker-compose.yml).
//
// Endpoints used (self-hosted OSS server — NO `/v1/` prefix):
//   POST /memories  body { messages:[{role,content}], user_id, metadata, infer }
//   POST /search    body { query, user_id, top_k }
//
// Design choices:
//   - add sends infer:false so Mem0 stores our text VERBATIM (no LLM fact
//     extraction), matching the mock's "store text, get it back" semantics.
//   - Our memory shape { id?, text, kind?, tags?, meta? } round-trips through
//     Mem0's `metadata` field (kind/tags/meta) + `content` (text) + `id`.
//   - fetchImpl is injectable so tests can drive a fake node:http server
//     without touching the network.

/**
 * Map our Memory { id?, text, kind?, tags?, meta? } to a Mem0 ADD request body.
 * Pure — no I/O. Only defined optional fields are placed in `metadata`.
 *
 * @param {{id?:string,text:string,kind?:string,tags?:string[],meta?:object}} memory
 * @param {string} userId
 * @returns {object} Mem0 POST /memories body
 */
export function toMem0AddBody(memory, userId) {
  const metadata = {};
  if (memory.kind !== undefined) metadata.kind = memory.kind;
  if (Array.isArray(memory.tags)) metadata.tags = [...memory.tags];
  if (memory.meta !== undefined) metadata.meta = memory.meta;

  const body = {
    messages: [{ role: "user", content: memory.text }],
    user_id: userId,
    // infer:false => raw memory, no LLM extraction (verbatim, like the mock).
    infer: false,
  };
  if (Object.keys(metadata).length > 0) body.metadata = metadata;
  return body;
}

/**
 * Map our query into a Mem0 SEARCH request body. Pure — no I/O.
 *
 * @param {string} query
 * @param {number} topK
 * @param {string} userId
 * @returns {object} Mem0 POST /search body
 */
export function toMem0SearchBody(query, topK, userId) {
  return { query, user_id: userId, top_k: topK };
}

/**
 * Map ONE Mem0 search result hit back into our contract's SearchHit.
 * Pure — no I/O. Reconstructs { id, text, kind?, tags?, meta? } from the Mem0
 * hit's `id` + `memory` (text) + `metadata`. Score defaults to 0 when absent.
 *
 * @param {object} hit  A Mem0 result: { id, memory, score?, metadata? }
 * @returns {{memory:object, score:number}}
 */
export function fromMem0SearchHit(hit) {
  const md = (hit && hit.metadata) || {};
  const memory = { id: hit.id, text: hit.memory };
  if (md.kind !== undefined) memory.kind = md.kind;
  if (Array.isArray(md.tags)) memory.tags = [...md.tags];
  if (md.meta !== undefined) memory.meta = md.meta;

  const score = typeof hit.score === "number" ? hit.score : 0;
  return { memory, score };
}

/**
 * Mem0 responses may be `{ results: [...] }` (Python client v1.1 shape) or a
 * bare array. Normalise to an array of hit objects. Defensive so the client
 * survives minor server-shape drift.
 */
function extractResults(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.results)) return json.results;
  return [];
}

/**
 * Create a real Mem0 HTTP client implementing the { add, search } contract.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl      e.g. "http://localhost:8888" (required)
 * @param {string} [opts.userId]     Mem0 partition key (default "gopilot")
 * @param {Function} [opts.fetchImpl] fetch-compatible impl (default global fetch)
 * @param {string} [opts.apiKey]     optional; sent as X-API-Key when auth is on
 * @returns {{add:(m:object)=>Promise<object>, search:(q:string,topK?:number)=>Promise<Array>}}
 */
export function createMem0Client({ baseUrl, userId = "gopilot", fetchImpl, apiKey } = {}) {
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error("createMem0Client: baseUrl is required");
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new Error("createMem0Client: no fetch available; pass fetchImpl");
  }
  const root = baseUrl.replace(/\/+$/, "");

  async function request(method, path, body) {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;
    const res = await doFetch(root + path, {
      method,
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* body already consumed / not readable */
      }
      throw new Error(
        `Mem0 ${method} ${path} failed: ${res.status} ${res.statusText}` +
          (detail ? ` — ${detail}` : ""),
      );
    }
    return res.json();
  }

  async function add(memory) {
    if (!memory || typeof memory.text !== "string" || memory.text.trim() === "") {
      throw new Error("add: memory.text is required and must be a non-empty string");
    }
    const json = await request("POST", "/memories", toMem0AddBody(memory, userId));
    const results = extractResults(json);
    // Mem0 assigns the durable id; fall back to a caller-provided id.
    const id = results[0]?.id ?? memory.id;

    const stored = { ...memory, id };
    if (stored.tags === undefined) delete stored.tags;
    return stored;
  }

  async function search(query, topK = 5) {
    // Match the mock: empty/whitespace query short-circuits to [] (no request).
    if (typeof query !== "string" || query.trim() === "") return [];

    const json = await request("POST", "/search", toMem0SearchBody(query, topK, userId));
    const hits = extractResults(json).map(fromMem0SearchHit);
    // Mem0 already ranks + applies top_k; sort/slice defensively for the contract.
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, Math.max(0, topK));
  }

  return { add, search };
}
