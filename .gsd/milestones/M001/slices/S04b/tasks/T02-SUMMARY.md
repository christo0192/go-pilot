---
task: S04b/T02
title: Live Mem0 integration (Step 4.3 done-when)
status: complete
duration: ~45min (incl. Docker install + 3 build bugs)
files_changed: [deploy/docker-compose.yml, deploy/.env.example, deploy/.env (gitignored), .gitignore]
verification: live_round_trip_ok, semantic_search_correct, unit_suite_128_pass
---
Real persistent Tier-2 store LIVE and validated end-to-end.

Path: Docker Engine installed natively inside WSL2 Ubuntu 26.04 (docker.io via apt + systemd) — NO Windows
restart. Prebuilt Mem0 image is arm64-only → built from source (sparse-cloned server/). Three runtime bugs
fixed in sequence: (1) `sh` couldn't `docker` from sandbox → user `chmod 666 /var/run/docker.sock`;
(2) `psycopg` "no pq wrapper" (slim base lacks libpq) → `pip install psycopg[binary]` in the start command;
(3) `sqlite3 unable to open database file` → added `mem0_history` volume at `/app/history` (HISTORY_DB_PATH).

Server UP (/docs 200, AUTH_DISABLED=true). LIVE round-trip via `src/memory/mem0-client.mjs` + user's OpenAI
embedder (text-embedding-3-small): added 3 memories, then semantic search returned the router memory first
(score 0.46) for "how does routing pick a model?" and the lunch memory (0.48) for "what is for lunch?" —
correct ranking. Step 4.3 done-when MET. Client shapes validated against the running server.

7 assumptions reconciled: endpoints/shapes ✓ (POST /memories, POST /search, no /v1/); {results:[...]} ✓;
top_k ✓; score present+ranged ✓; embedder REQUIRED ✓ (OpenAI); AUTH_DISABLED=true ✓; image pinned = TODO
(still :built-from-source `latest` sparse clone — pin the mem0 commit for reproducibility).

SECURITY: user's OpenAI key lives only in gitignored deploy/.env. It was pasted in chat → RECOMMEND ROTATION.
Residual: real per-class live sign-off (D17) still needs baseline-rig runs; wire real adapter into
promotion/recall call sites (currently they accept any {add,search} adapter — mock or mem0-client).
