---
name: pg-dev
description: PostgreSQL local development with Docker — run, connect, persistence, init scripts, Mac filesystem perf, ARM/x86 images, networking, and honest production-parity limits. Use when setting up local Postgres, connecting from app or CLI, or hitting Docker Postgres limitations.
---

# PG Dev (Docker Local)

Local Postgres via Docker for development. Covers run, connect, persistence, init, and the limitations that bite.

## Quick start

```bash
docker run -d --name postgres \
  -p 127.0.0.1:5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=app \
  -v pg-data:/var/lib/postgresql/data \
  postgres:16
```

Connect from host:

```bash
psql "host=127.0.0.1 port=5432 user=postgres password=postgres dbname=app"
```

Or via the `pg_query` tool — set the connection via `/pg-connect` first (writes `.omp/agent/pg.json` at the repo root), or use `PGUSER=postgres PGPASSWORD=postgres PGDATABASE=app PGHOST=127.0.0.1` env vars as a fallback.

## Connection resolution

1. `.omp/agent/pg.json` (run `/pg-connect` to write it).
2. `PGUSER` / `PGPASS` / `PGHOST` / `PGPORT` / `PGDATABASE` env vars.
3. Defaults: `127.0.0.1:5432`, no default DB.

See [REFERENCE.md](REFERENCE.md) for engine idiosyncrasies — EXPLAIN ANALYZE, `pg_stat_statements`, lock views, and the small knobs that pay off.

## Persistence

- Named volume `pg-data` (see Quick start) persists across `docker rm -f postgres`. Skipping `-v` loses the DB.
- `docker exec postgres pg_dump -U postgres app > backup.sql` — snapshot while data lives on a volume.

## Init scripts

Drop `*.sql` or `*.sh` in `/docker-entrypoint-initdb.d/`. They run once at first boot (only when the data dir is empty):

```bash
docker run -d --name postgres \
  -v "$PWD/init/01-schema.sql:/docker-entrypoint-initdb.d/01-schema.sql" \
  -p 127.0.0.1:5432:5432 postgres:16
```

## Perf on macOS

- Named volumes (`pg-data`) are faster than bind mounts on Apple Silicon (virtiofs vs gRPC FUSE). Bind mounts only when you need host-visible files.
- Time zone: container is UTC by default. Set `TZ=America/Sao_Paulo` if your tests need local time.

## When NOT to use Docker Postgres

- Full replica semantics (`hot_standby_feedback`, synchronous commit). Docker covers `citus`-style networking poorly.
- Realistic harness-level RPO testing (WAL archiving, PITR). Use a real cloud instance.
- Anything needing `systemd`, `pg_upgrade` across majors, or giant shared_buffers tuning.

## Honest parity limits

- **No production identity**: local `postgres` superuser + open ports. Never bake real data into images.
- **No slow query log persistence** unless you mount `/var/lib/postgresql/data/log` (and set `log_filename`, `log_destination`).
- **`pg_stat_statements`** is loaded by default in the official image; disable with `shared_preload_libraries` override only if you must. See REFERENCE.md.
- **Charset**: default `utf8` + `en_US.utf8`. Explicit `--lc-collate=C` only if your app relies on binary collation.
- **Connection limits**: default `max_connections=100`. Integration tests spawning parallel connections may need to raise it via command: `command: -c max_connections=400`.

## Seed / restore

```bash
# From a dump file
docker exec -i postgres psql -U postgres app < dump.sql

# Or via the plugin tools: read the dump, pass to pg_exec
```

## Compose

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    ports: ["127.0.0.1:5432:5432"]
    volumes: [pg-data:/var/lib/postgresql/data]
volumes:
  pg-data:
```
