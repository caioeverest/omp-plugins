---
name: pg-connect
description: Configure the Postgres connection used by the pg_* tools — ask the user for host/port/user/password/database, verify reachability, and persist to .omp/agent/pg.json at the repo root (or cwd outside a git repo). Use when pg_query/pg_exec/pg_explain report `missing Postgres user`, or the user wants to switch servers. Not for standing up a local server (pg-dev) or tuning queries (pg-queries).
---

# PG Connect

Prompt the user for connection details, verify reachability, persist to the project. Called when pg_* tools throw `missing Postgres user`.

## Flow

1. **Ask** via the `ask` tool — one HTML `<form>` whose controls are named for the fields below; preselect with `value`/`selected`, mark `user` `required`.
2. **Test** with a direct `psql` call (see below). The pg_* tools read their connection from `.omp/agent/pg.json` or the agent process env at call time, so `export` in a bash call does not reach them.
3. **Persist** to `.omp/agent/pg.json` at the repo root (`git rev-parse --show-toplevel`), else cwd.
4. **Confirm** with `pg_query` (`SELECT 1`), then tell the user the fields written (plaintext — this JSON is NOT encrypted) and the resolved path.

## Questions

Ask one `ask` form with these named controls. Prefill from `.omp/agent/pg.json` if present, else env, else defaults:

- `host` — default `127.0.0.1`. Accept hostname or IP.
- `port` — default `5432`.
- `database` — default `postgres`. Optional.
- `user` — no default; REQUIRED.
- `password` — default empty (prompts `.pgpass` fallback).

## Test before write

```bash
# Trivial read with the candidate values, before anything is persisted
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres \
  psql --no-psqlrc --no-align -c "SELECT 1" postgres
```

After writing, re-check through `pg_query` (`SELECT current_database(), current_user`). On failure ask whether to (a) retry with new values, (b) use defaults, or (c) skip the file and rely on `PG*` env vars / `~/.pgpass`.

## Write

Locate the repo root, then write the file:

```bash
git rev-parse --show-toplevel
# Use that path; fallback to $(pwd) when git fails
mkdir -p <root>/.omp/agent
```

Then write via the Write tool:

```json
{
  "host": "127.0.0.1",
  "port": 5432,
  "user": "postgres",
  "password": "postgres",
  "database": "postgres"
}
```

Omit keys that are empty (e.g. `password` when the user relies on `.pgpass`) — runtime falls back to env.

## Credential handling

Prefer a mechanism that keeps the password out of the project: `PG*` variables in the environment OMP starts with (works for CI; a shell `export` mid-session does not reach the tools), or `~/.pgpass` (mode `0600`, outside the repository). Say so and skip the file write when that is what the user wants.

If the user chooses `.omp/agent/pg.json`, all of the following apply:

1. The file is **plaintext JSON** — no field is encrypted, and nothing here protects the password at rest beyond filesystem permissions.
2. Before writing any secret, verify the destination is Git-excluded: run `git check-ignore -q .omp/agent/pg.json`. If it exits non-zero, add `.omp/agent/pg.json` to the repository `.gitignore`, then re-run the check and confirm it now exits zero.
3. After writing, restrict permissions: `chmod 600 <path>`.
4. Never paste the file's contents into chat, logs, tool output, or a commit.

## Post-write

- Name the pg_* tools that now pick the file up (`pg_query`, `pg_exec`, `pg_explain`, `pg_table_info`, `pg_locks`, `pg_stats`).

## Pitfalls

- Never log passwords to stdout — only the file write.
- Don't overwrite `.omp/agent/pg.json` if it already has the same values; still update when values changed, and confirm with the user if replacing a non-trivial password with an empty one.
- If the user picks to skip the file and just rely on env, don't write — say so and move on.
