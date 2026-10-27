---
name: pg-connect
description: Configure Postgres connection for pg_* tools — ask the user for host/port/user/password/database, test the connection, and persist to .omp/agent/pg.json at the repo root (or cwd when not a git repo). Use when pg_query/pg_exec/pg_explain report missing connection, or when the user wants to switch to a different Postgres server.
---

# PG Connect

Prompt the user for connection details, verify reachability, persist to the project. Called when pg_* tools throw `missing Postgres user`.

## Flow

1. **Ask** via the `ask` tool. Suggested defaults in dropdown where obvious.
2. **Test** the connection by running `pg_query` with `SELECT 1`. If the env has no config yet, temporarily put the values into env for the test call.
3. **Persist** to `.omp/agent/pg.json` at the repo root (`git rev-parse --show-toplevel`), else cwd.
4. **Confirm** the user sees a toast listing the fields (plaintext — this JSON is NOT encrypted) and the resolved path.

## Questions

Ask one batched `ask` with these. Prefill from `.omp/agent/pg.json` if present, else env, else defaults:

- `host` — default `127.0.0.1`. Accept hostname or IP.
- `port` — default `5432`.
- `database` — default `postgres`. Optional.
- `user` — no default; REQUIRED.
- `password` — default empty (prompts `.pgpass` fallback).

## Test before write

```bash
# Set env for the test, run a trivial read
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres \
  psql --no-psqlrc --no-align -c "SELECT 1" postgres
```

Or use the `pg_query` tool once the env is set in the current shell:

```bash
export PGHOST=127.0.0.1
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=postgres
export PGDATABASE=postgres
# then call pg_query SELECT 1 — verify ok
```

If the test fails, ask whether to (a) retry with different values, (b) fall back to defaults, or (c) leave env vars set and skip writing the file.

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

Prefer a mechanism that keeps the password out of the project: export `PG*` variables for the session, or use `~/.pgpass` (mode `0600`, outside the repository). Say so and skip the file write when that is what the user wants.

If the user chooses `.omp/agent/pg.json`, all of the following apply:

1. The file is **plaintext JSON** — no field is encrypted, and nothing here protects the password at rest beyond filesystem permissions.
2. Before writing any secret, verify the destination is Git-excluded: run `git check-ignore -q .omp/agent/pg.json`. If it exits non-zero, add `.omp/agent/pg.json` to the repository `.gitignore`, then re-run the check and confirm it now exits zero.
3. After writing, restrict permissions: `chmod 600 <path>`.
4. Never paste the file's contents into chat, logs, tool output, or a commit.

## Post-write

- Tell the user which path was written and which pg_* tools will now pick it up.
- Suggest `SELECT current_database(), current_user` via `pg_query` as a sanity read.

## Pitfalls

- Never log passwords to stdout — only the file write.
- Don't overwrite `.omp/agent/pg.json` if it already has the same values; still update when values changed, and confirm with the user if replacing a non-trivial password with an empty one.
- If the user picks to skip the file and just rely on env, don't write — say so and move on.
