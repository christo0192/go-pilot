# S04b: Real Mem0 (Step 4.3) — Docker path chosen by user 2026-07-09

Wires the real persistent Tier-2 store behind the existing D23 `{add, search}` mock contract.
Split into Docker-INDEPENDENT prep (buildable now) and integration (needs the user's Docker install).

## Tasks
- [x] **T01: Mem0 compose + real HTTP client + fake-server tests** (Docker-independent prep) ✅ 128/128
  `deploy/docker-compose.yml` (mem0 API server + postgres/pgvector, port 8888→8000, healthchecks, env
  placeholders), `src/memory/mem0-client.mjs` (`createMem0Client` implementing the D23 contract over HTTP;
  pure mappers `toMem0AddBody`/`toMem0SearchBody`/`fromMem0SearchHit`), tests vs a node:http fake server.
  Mem0 self-hosted API (researched): `POST /memories` {messages,user_id,metadata,infer} → {results:[{id,memory,event}]};
  `POST /search` {query,user_id,top_k} → {results:[{id,memory,score,...}]}. Image `mem0/mem0-api-server`.

- [x] **T02: Live integration** ✅ 2026-07-09 (Step 4.3 done-when MET)
  Docker Engine installed natively in WSL2 (no restart). Built Mem0 from source (arm64-only prebuilt), fixed
  two runtime bugs: (1) `psycopg[binary]` installed at start (slim image lacks libpq), (2) `mem0_history` volume
  for HISTORY_DB_PATH=/app/history/history.db. Server UP (/docs 200). LIVE round-trip via mem0-client with the
  user's OpenAI embedder: added 3 memories, semantic search ranked the router memory first (0.46) for a routing
  query and the lunch memory (0.48) for a lunch query — correct. Fact written → retrievable by semantic query. ✅

## Assumptions to re-verify against the running server (from research)
1. Response `{results:[...]}` (v1.1) vs bare array (v1.0) — client tolerates both. 2. `infer:false` stores verbatim.
3. `top_k` vs older `limit`. 4. `score` present + comparably ranged. 5. **Embedder required for search** (see BLOCKER).
6. Compose `:latest` — pin after first pull. 7. `AUTH_DISABLED=true` for local dev, else pass `apiKey`.
