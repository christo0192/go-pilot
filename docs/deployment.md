# Deployment — Mem0 stack (dev vs prod, pins, backup/restore)

Step 8.5 hardening for the self-hosted Mem0 (Tier-2 memory) stack in
[`deploy/`](../deploy). Local dev stays frictionless; a thin prod override adds
fail-closed secrets. The workhorse gateway is the hosted **Ikey**
(`https://ikey-gateway.fly.dev`) by default — see
[`workhorse-plane.md`](workhorse-plane.md).

## Files

| File | Role |
|---|---|
| [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) | DEV default. Dev secrets OK, `AUTH_DISABLED=true`, all ports bound to `127.0.0.1`. |
| [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) | PROD override. Enables Mem0 auth, removes dev-default secrets, fails closed on missing secrets. |
| [`deploy/mem0.Dockerfile`](../deploy/mem0.Dockerfile) | Reproducible Mem0 image — `psycopg[binary]` baked in at build (no per-boot `pip install`). |
| [`deploy/.env.example`](../deploy/.env.example) | Copy to `deploy/.env` and fill. |

## Dev (default)

```bash
cd deploy
# one-time: fetch the Mem0 build context (git-ignored sparse clone)
git clone --filter=blob:none --no-checkout --depth 1 https://github.com/mem0ai/mem0.git mem0-src
cd mem0-src && git sparse-checkout set server && git checkout && cd ..

cp .env.example .env    # fill OPENAI_API_KEY (embedder); dev secrets are fine
docker compose up -d --build
```

Starts `mem0` (`127.0.0.1:8888`) + `postgres` (internal-only). The optional local
LiteLLM is NOT started (it is behind the `local-litellm` profile — use Ikey, or
`docker compose --profile local-litellm up -d litellm` for offline).

## Prod (fail-closed override)

```bash
cd deploy
# deploy/.env MUST define (no dev fallback — compose refuses to start otherwise):
#   POSTGRES_PASSWORD   (a real password, not mem0devpass)
#   MEM0_JWT_SECRET     (openssl rand -hex 32)
#   MEM0_ADMIN_API_KEY  (openssl rand -hex 32)
docker compose -f docker-compose.yml -f docker-compose.prod.yml config    # validate first
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The override sets `AUTH_DISABLED=false`, wires `MEM0_JWT_SECRET`→`JWT_SECRET` and
`MEM0_ADMIN_API_KEY`→`ADMIN_API_KEY`, and re-requires `POSTGRES_PASSWORD` — each
via `${VAR:?message}`, so an unset/empty secret makes `up`/`config` fail loudly
with a named message instead of silently booting with a dev default. Ports stay
`127.0.0.1`-bound. If you also run the local gateway
(`--profile local-litellm`), `LITELLM_MASTER_KEY` becomes required too.

## Pinned images (reproducibility)

| Image | Pin | Notes |
|---|---|---|
| postgres (pgvector) | `pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0` | Multi-arch (amd64+arm64) index digest. Re-pin: `docker manifest inspect pgvector/pgvector:pg17`. |
| mem0 | built from `deploy/mem0.Dockerfile` | `python:3.12-slim` + pinned `requirements.txt` + `psycopg[binary]`. |
| litellm (optional) | `ghcr.io/berriai/litellm:main-v1.23.9` | Exact version (was floating `:main-stable`). linux/amd64; arm64 → use Ikey or an arm64 tag. |

## Backup / restore — `mem0_pgdata` volume

The Mem0 memories live in Postgres, persisted in the `deploy_mem0_pgdata` volume
(project-prefixed; `docker compose ... config --volumes` lists the short names).
Back up logically with `pg_dump` while the stack is up. Adjust `-U/-d` if you
changed `POSTGRES_USER`/`POSTGRES_DB` (defaults: `postgres`/`postgres`).

```bash
cd deploy

# Backup (compressed custom-format dump):
docker compose exec -T postgres pg_dump -U postgres -d postgres -Fc \
  > "mem0-backup-$(date +%Y%m%d-%H%M%S).dump"

# Restore into a running stack (clean rebuild of objects):
docker compose exec -T postgres pg_restore -U postgres -d postgres --clean --if-exists \
  < mem0-backup-YYYYMMDD-HHmmss.dump
```

Plain-SQL variant (portable, greppable):

```bash
docker compose exec -T postgres pg_dump -U postgres -d postgres > mem0-backup.sql
docker compose exec -T postgres psql   -U postgres -d postgres < mem0-backup.sql
```

Full volume snapshot (binary, exact — stop the stack first for consistency):

```bash
docker compose stop postgres
docker run --rm -v deploy_mem0_pgdata:/data -v "$PWD":/backup alpine \
  tar czf /backup/mem0_pgdata.tgz -C /data .
docker compose start postgres
# restore: docker run --rm -v deploy_mem0_pgdata:/data -v "$PWD":/backup alpine \
#   sh -c "rm -rf /data/* && tar xzf /backup/mem0_pgdata.tgz -C /data"
```

The `deploy_mem0_history` volume (Mem0's SQLite change-history) can be snapshotted
the same way if you want the audit trail; the pgdata dump holds the memories.
