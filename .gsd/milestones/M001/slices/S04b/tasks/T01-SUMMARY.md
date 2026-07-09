---
task: S04b/T01
title: Mem0 compose + real HTTP client + fake-server tests (Step 4.3 prep)
status: complete
duration: ~12min
files_changed: [deploy/docker-compose.yml, src/memory/mem0-client.mjs, src/memory/mem0-client.test.mjs, src/memory/mem0-client.README.md]
verification: node_test_128_pass, clean_exit, zero_deps
---
Docker-independent prep for real Mem0. `createMem0Client({baseUrl,userId?,fetchImpl?,apiKey?})` implements the
same D23 `{add,search}` contract as the mock, over HTTP (built-in fetch; injectable for tests). Pure mappers
`toMem0AddBody`/`toMem0SearchBody`/`fromMem0SearchHit`. `deploy/docker-compose.yml` = mem0 API server
(`mem0/mem0-api-server`) + postgres/pgvector, 8888→8000, healthchecks, `.env` placeholders. Tested vs a
node:http fake server (method/path/body asserts + response parse; empty→[]; non-2xx→throws). 13 tests, 128/128.

Researched Mem0 self-hosted API (source URLs in README): `POST /memories` {messages,user_id,metadata,infer} →
{results:[{id,memory,event}]}; `POST /search` {query,user_id,top_k} → {results:[{id,memory,score,...}]}.
7 assumptions flagged to re-verify live (see S04b-PLAN). KEY GAP: Mem0 search needs an EMBEDDER even with
infer:false — pure-anthropic has none → user must wire an embedding provider before E2E search. Real
integration = S04b/T02, BLOCKED on user Docker install.
