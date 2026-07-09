# Mem0 HTTP client — real Tier-2 store (drop-in for the mock)

`createMem0Client({ baseUrl, userId?, fetchImpl?, apiKey? })` implements the SAME
`{ add, search }` contract as `createMockMem0()` in `mem0-adapter.mjs` (the D23
coupling point). Callers written against the mock work unchanged against a real
self-hosted Mem0 server — only the factory swaps.

- `add(memory)` — `POST /memories`, returns the stored memory with Mem0's id.
- `search(query, topK = 5)` — `POST /search`, returns `≤ topK` `{ memory, score }`
  ranked highest-first; `[]` on empty/whitespace query or empty result set.

`fetchImpl` defaults to global `fetch` and is injectable for tests. Non-2xx
responses throw a clear `Error` with the status and body.

Status: unit-tested against a FAKE `node:http` server (request wire shape +
response parsing proven). **Real end-to-end integration is PENDING the user's
Docker install** — see `deploy/docker-compose.yml`.

## Researched endpoints + shapes (self-hosted OSS server)

The self-hosted **OSS** server (`mem0ai/mem0` → `server/`) does **NOT** use the
hosted platform's `/v1/` path prefix. Verified endpoints:

### ADD — `POST /memories`
Request:
```json
{ "messages": [{ "role": "user", "content": "I love vegetable pizza." }],
  "user_id": "alice", "metadata": { "kind": "pref" }, "infer": false }
```
We send `infer:false` so Mem0 stores the text VERBATIM (no LLM fact extraction),
matching the mock's "store text, get it back" behaviour. Response (Python client
v1.1 shape, returned by the server unwrapped):
```json
{ "results": [{ "id": "<uuid>", "memory": "I love vegetable pizza.", "event": "ADD" }] }
```
The client also tolerates a bare array response.

### SEARCH — `POST /search`
Request:
```json
{ "query": "vegetable", "user_id": "alice", "top_k": 5 }
```
Response:
```json
{ "results": [{ "id": "<uuid>", "memory": "...", "score": 0.87,
                "metadata": { "kind": "pref" }, "user_id": "alice", "created_at": "..." }] }
```
We map each hit → `{ memory: { id, text, kind?, tags?, meta? }, score }`, pulling
`kind/tags/meta` back out of `metadata`, `text` from `memory`, and `score`
(default `0` if absent).

### Docker image + port
- Image: `mem0/mem0-api-server` (official OSS server; the repo's
  `server/docker-compose.yaml` alternatively builds from `server/dev.Dockerfile`).
- Port: container **8000**, published on host **8888** — matches
  `MEM0_BASE_URL=http://localhost:8888` in `.env.example`.
- Backing store: Postgres + pgvector (default self-hosted vector store).
- Auth: on by default (JWT or `X-API-Key`). Our compose sets `AUTH_DISABLED=true`
  for the local single-node store; the client passes `apiKey` as `X-API-Key`
  when auth is enabled.

### Sources
- REST API Server (endpoints, curl examples, ports, "no /v1/ prefix"):
  https://docs.mem0.ai/open-source/features/rest-api
- Official server compose (image/build, `8888:8000`, env, depends_on):
  https://github.com/mem0ai/mem0/blob/main/server/docker-compose.yaml
- Server routes (`POST /memories`, `POST /search`, request models):
  https://github.com/mem0ai/mem0/blob/main/server/main.py

## Assumptions to re-verify against the RUNNING server (D23 follow-up)

1. **Response wrapper.** Assumed `{ "results": [...] }` (Python client v1.1). The
   FastAPI server returns `memory.add()/search()` **unwrapped**, so if the pinned
   `mem0ai` lib is configured to `api_version="v1.0"` it may return a **bare
   array**. The client tolerates both, but confirm live.
2. **`infer:false` is honoured** by the `/memories` route and stores text
   verbatim (so `search` returns our exact text, not an LLM-extracted fact).
3. **`top_k`** is the correct search-limit field on the current server (older
   builds used `limit`). Confirm; adjust `toMem0SearchBody` if needed.
4. **Search score** is present and in a comparable range for ranking.
5. **Embedder/LLM config.** pure-anthropic has no embeddings API; Mem0's default
   embedder is OpenAI. Vector `search` REQUIRES an embedder even with
   `infer:false`, so a cheap embedding provider must be wired in `.env`
   (`MEM0_LLM_KEY`/`OPENAI_API_KEY`) before search works end-to-end.
6. **Image tag.** `deploy/docker-compose.yml` uses `:latest` (unpinnable without
   Docker); pin to a verified digest/tag after first successful pull.
7. **Auth.** Compose disables auth for local dev; if enabled, pass `apiKey`.
