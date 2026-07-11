# Go-pilot — reproducible Mem0 image (Step 8.5).
# =============================================================================
# WHY THIS FILE EXISTS
#   The upstream sparse-cloned prod Dockerfile (deploy/mem0-src/server/Dockerfile)
#   is `python:3.12-slim` + requirements.txt. That slim base has NO libpq, so the
#   `psycopg` in requirements can't find its "pq wrapper" at runtime. The old
#   docker-compose ran `pip install psycopg[binary]` inside the service `command`
#   on EVERY startup — non-reproducible, network-dependent, and slow to boot.
#
#   This Dockerfile bakes `psycopg[binary]` (which bundles libpq) INTO the image
#   at build time. Startup then only runs `alembic upgrade head && uvicorn`
#   (migrations still need a live DB, so they stay at runtime — they can't be
#   baked in). Result: deterministic image, fast idempotent boots.
#
# BUILD CONTEXT
#   Built with context = deploy/mem0-src/server (the fully-populated sparse
#   checkout), so the COPY lines below mirror the upstream Dockerfile exactly.
#   Referenced from deploy/docker-compose.yml as:
#     build:
#       context: ./mem0-src/server
#       dockerfile: ../../mem0.Dockerfile
#   (Re)fetch the context per the header of docker-compose.yml if mem0-src is
#   missing (it is git-ignored).
# =============================================================================

FROM python:3.12-slim

WORKDIR /app

# Deps first for layer caching, then psycopg[binary] (bundles libpq — the one
# thing the slim base lacks). No apt libpq-dev needed thanks to the [binary] wheel.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir 'psycopg[binary]'

# App source (server/ checkout: main.py, alembic/, init-db.sh, etc.)
COPY . .

EXPOSE 8000
ENV PYTHONUNBUFFERED=1

# Default CMD mirrors upstream prod (no --reload). docker-compose overrides this
# with `alembic upgrade head && uvicorn ...` so the schema is migrated first.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
