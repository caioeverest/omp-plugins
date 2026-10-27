# PG Reference — Engine Idiosyncrasies

Per-database specifics that don't fit the SKILL flow. Go back to [SKILL.md](SKILL.md) when you're done.

## EXPLAIN flavors

- `EXPLAIN` — server-side plan, no execution. Cheap, safe on any query, including DML you don't want to run.
- `EXPLAIN ANALYZE` — runs the query (DML runs for real; use `BEGIN`...`ROLLBACK`). Adds `actual time`, `rows`, `loops`.
- `EXPLAIN (ANALYZE, BUFFERS)` — plus buffer hits/reads. The default in the `pg_explain` tool when `analyze=true`.
- `EXPLAIN (COSTS OFF)` — when the chosen cost numbers themselves are distracting; usually leave on, ADD `BUFFERS` when worried about I/O.
- `EXPLAIN (FORMAT JSON)` — when piping to a visualizer (see "Visualizers" below).

Access types in plan output:

| type | meaning |
|------|---------|
| `Seq Scan` | full table scan — fine for < a few thousand rows, suspect otherwise |
| `Index Scan` | index fetch + heap lookup |
| `Index Only Scan` | covered columns live in the index — no heap hits |
| `Bitmap Scan` | bulk index union — when selectivity is moderate |
| `CTE Scan` / `Subquery Scan` | usually a WAL-free CTE or uncorrelated subquery |

## Common gotchas

- `LIMIT` interacts badly with `ORDER BY` on non-sorted columns: the whole sort runs the rows. Add the ORDER BY column to the index if it's filtered.
- `Seq Scan` on a small dimension table is fine; don't chase it.
- `Row width spill` shows up when `ORDER BY`/`GROUP BY`/`JOIN` go over `work_mem`. Raise per session: `SET work_mem='64MB'`.
- `ANALYZE` on plans will mislead when the table is `${volatility_threshold}` stale. Run `ANALYZE table_name` first before trusting `rows`.
- `JIT` overhead: complex aggregates/JOINs can blow 100+ ms on JIT compilation when `enable_jit=on`. For a single short query — disable per query: `SET jit=off`.

## pg_stat_statements

Preloaded in the official image. Query the aggregate of all executed statements ranked by total time:

```sql
SELECT query,.calls, total_time, mean_time, rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 20;
```

Reset when you want a clean read: `SELECT pg_stat_statements_reset()`. The `pg_stats` tool returns `pg_stat_database` counters + activity split by state; pg_stat_statements runs separately via `pg_query`.

## pg_locks vocabulary

- `locktype` — `relation`, `virtual`, `transactionid`, `tuple`, `page`, `object`, `userlock`, `advisory`.
- `mode` — `AccessShareLock`, `RowShareLock`, `RowExclusiveLock`, `ShareUpdateExclusiveLock`, `ExclusiveLock`, `AccessExclusiveLock`. From least to most intrusive; DDL like `ALTER TABLE` takes `AccessExclusiveLock` and blocks `SELECT`.
- `granted` — `false` = blocked, `true` = acquired.
- `virtual` — transaction id lock, common when writing.

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
| `random_page_cost` | 4 (cmr) | tune down to ~1.1 for SSD |

## pg_stat_io (PG16+)

Per-backend per-object IO breakdown. On PG16 the `pg_stats` tool returns `pg_stat_database` counters — add a one-liner via `pg_query` for `pg_stat_io` when diagnosing noisy neighbors.

## Extensions worth caching

- `pg_stat_statements` — always.
- `uuid-ossp` / `pgcrypto` — for `uuid` and digest functions.
- `postgis`, `pg_trgm`, `btree_gist` when the schema calls for it.
