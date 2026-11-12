# PG Reference — Engine Idiosyncrasies

Per-database specifics that don't fit the SKILL flow. Go back to [SKILL.md](SKILL.md) when you're done.

## EXPLAIN flavors

- `EXPLAIN` — server-side plan, no execution. Cheap, safe on any query, including DML you don't want to run.
- `EXPLAIN ANALYZE` — runs the query (DML runs for real; use `BEGIN`...`ROLLBACK`). Adds `actual time`, `rows`, `loops`.
- `EXPLAIN (ANALYZE, BUFFERS)` — plus buffer hits/reads. The default in the `pg_explain` tool when `analyze=true`.
- `EXPLAIN (COSTS OFF)` — drops the cost estimates when the numbers distract; keep `BUFFERS` on for I/O detail.
- `EXPLAIN (FORMAT JSON)` — when piping to a visualizer (see "Visualizers" below).

Plan node reading (Seq Scan vs Index Scan vs Index Only Scan, joins, spills) lives in `skill://pg-queries`; index choices in `skill://pg-indexes`.

## Common gotchas

- `LIMIT` with `ORDER BY` on a non-sorted column still sorts every candidate row: add the ORDER BY column to the index that serves the filter.
- `Seq Scan` on a small dimension table is fine; don't chase it.
- Row-width spill appears when `ORDER BY`/`GROUP BY`/`JOIN` exceed `work_mem`. Raise per session: `SET work_mem='64MB'`.
- `EXPLAIN` row estimates mislead when the table has churned since the last stats refresh. Run `ANALYZE table_name` before trusting `rows`.
- JIT compilation can add 100+ ms to a single short query. Disable per session: `SET jit=off`.

## pg_stat_statements

Not preloaded in the official image. Enable it once:

```yaml
command: -c shared_preload_libraries=pg_stat_statements
```

then `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` in the database. Query the aggregate of all executed statements ranked by total time:

```sql
SELECT query, calls, total_time, mean_time, rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 20;
```

Reset when you want a clean read: `SELECT pg_stat_statements_reset()`. The `pg_stats` tool returns `pg_stat_database` counters + activity split by state; pg_stat_statements runs separately via `pg_query`.

## pg_locks vocabulary

`locktype`, `mode` ordering, and `granted` semantics live in `skill://pg-locking`. The `pg_locks` tool returns both `pg_stat_activity` wait state and the blocked→blocking pair graph.

## pg_stat_activity wait_event_type

- `Lock` — waiting on a lock.
- `IO` — synchronous IO (disk).
- `Client` — client read/write.
- `IPC` — waiting on another backend.
- `LWLock` — internal lightweight lock (often `WALWrite`, `WALInsert`, buffer pins).

Query: `SELECT state, wait_event_type, wait_event, count(*) FROM pg_stat_activity GROUP BY 1,2,3`.

## Visualizers

Paste `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` output into:

- https://explain.dalibo.com (locally rendered, no upload)
- https://explain.depesz.com (server, supports pdf output)
- pgsql-client (inside pgAdmin) also renders plans graphically.

## Important knobs

| knob | default | when to raise/lower |
|------|---------|---------------------|
| `max_connections` | 100 | raise cautiously — connection stalls override |
| `shared_buffers` | 128MB | 25-40% RAM on dedicated box |
| `work_mem` | 4MB | sort/hash spills on EXPLAIN |
| `effective_cache_size` | 4GB | let planner assume RAM is free |
| `random_page_cost` | 4 (spinning disk) | tune down to ~1.1 for SSD |

## pg_stat_io (PG16+)

Per-backend per-object IO breakdown. On PG16 the `pg_stats` tool returns `pg_stat_database` counters — add a one-liner via `pg_query` for `pg_stat_io` when diagnosing noisy neighbors.

## Extensions worth enabling

- `pg_stat_statements` — when you profile (see above).
- `uuid-ossp` / `pgcrypto` — for `uuid` and digest functions.
- `postgis`, `pg_trgm`, `btree_gist` when the schema calls for it.
