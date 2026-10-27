---
name: pg-indexes
description: PostgreSQL index design — btrees, covering indexes (INCLUDE), expression indexes, partial indexes, GIN/GiST/SP-GiST/BRIN, concurrent index builds, pg_stat_usage monitoring, EXPLAIN-driven index choices. Use when designing indexes, reviewing schema, diagnosing full table scans, or choosing index columns.
---

# PG Indexes

Choosing, building, and maintaining PostgreSQL indexes.

## Tool usage

- `pg_table_info` — column list + `pg_indexes` output.
- `pg_explain` — verify the planner picks the index you expect.
- `pg_exec` — `CREATE INDEX`, `CREATE INDEX CONCURRENTLY`, `DROP INDEX`, `ANALYZE`.

## Index types

| type | use |
|------|-----|
| B-tree (default) | equality, range, prefix, ORDER BY, `IS NULL` |
| Hash | equality only, narrow use; btree is usually better |
| GIN | inverted: arrays, JSONB, full-text, trigram search |
| GiST | generalized: geometry, tsvector range queries |
| SP-GiST | partitioned space (long text, IP ranges) |
| BRIN | block-range index on correlated time-series; tiny footprint |
| Bloom (contrib) | multi-column approximate match |

## Composite index design

### Left-prefix rule

Index `(a, b, c)` serves:
- `WHERE a = ?`
- `WHERE a = ? AND b = ?`
- `WHERE a = ? AND b = ? AND c = ?`
- `WHERE a = ? AND b > ?` (range on `b` — `c` still usable for sort/filter in PG 13+)

Cannot serve:
- `WHERE b = ?` (no `a` prefix)
- `WHERE a = ? AND c = ?` (skips `b`)

**Design order**: equality first, range second, sort last. Same as MySQL.

### Covering (INCLUDE)

PG 11+ lets you pack non-key columns into a btree index:

```sql
-- SELECT user_id, status FROM orders WHERE created_at > '2026-01-01'
CREATE INDEX idx_orders_created ON orders(created_at) INCLUDE (user_id, status);
```

Plan shows `Index Only Scan` — no heap fetch. Cheaper than packing key columns into a fat composite: the index doesn't have to keep INCLUDE columns sorted.

### Partial index

Index only the rows you query:

```sql
-- SELECT * FROM orders WHERE status = 'pending' (rare, tiny subset)
CREATE INDEX idx_orders_pending ON orders (created_at) WHERE status = 'pending';
```

Smaller, faster. Only serves queries whose WHERE clause implies the predicate.

### Expression index

```sql
CREATE INDEX idx_users_email_lower ON users (lower(email));

-- Then this uses the index:
SELECT * FROM users WHERE lower(email) = 'a@b.com';
```

Solves the "function on column blocks index" problem without rewriting queries.

## GIN for JSONB / arrays / text

```sql
CREATE INDEX idx_events_json ON events USING GIN (data);
-- Then: WHERE data @> '{"user_id": 42}' is index-served

CREATE INDEX idx_users_tags ON users USING GIN (tags);
-- Then: WHERE tags && ARRAY['a','b'] is index-served
```

For substring search `ILIKE '%x%'`: enable `pg_trgm`, then:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_text_trgm ON documents USING GIN (text gin_trgm_ops);
```

## Concurrent build

Plain `CREATE INDEX` takes `ShareUpdateExclusiveLock` = blocks writes during the build. On a big table use concurrent:

```sql
CREATE INDEX CONCURRENTLY idx_orders_created ON orders(created_at);
-- No table lock; slower total build; can fail under load.
```

Gotchas: `CONCURRENTLY` can't run inside a transaction (`BEGIN ... COMMIT` must wrap it OUTSIDE). Watch `pg_stat_progress_create_index` if it hangs.

## BRIN for time-series

```sql
CREATE INDEX idx_ts_created ON events USING BRIN (created_at);
```

Tiny, fast to build, serves `WHERE created_at BETWEEN ... AND ...` when data is physically ordered by that column (time-series inserts). Doesn't help point lookups — keep the btree too.

## Selectivity

```sql
SELECT count(DISTINCT status)::float / count(*) FROM orders;
```

High (>0.1) → good candidate. Low → planner often picks `Seq Scan`. Composite to rescue: `(status, created_at)` only works if the second column narrows further.

## When NOT to index

- Small tables (< a few thousand rows) — `Index Scan` overhead > `Seq Scan`.
- Write-heavy tables — every index adds INSERT/UPDATE/DELETE cost.
- Hot-swapping lookup tables cached at the app.
- B-tree on huge `bytea`/`text` — index a substring prefix or use GIN/GiST instead.

## Maintenance

```sql
-- Check usage
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan;

-- Unused indexes (candidates for DROP)
SELECT schemaname, relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan < 10;

-- Bloat (pg_stat_usage)
SELECT relname, n_dead_tup FROM pg_stat_user_tables ORDER BY n_dead_tup DESC;

-- Reindex a bloated index without downtime
REINDEX INDEX CONCURRENTLY idx_orders_created;

-- Find duplicates
SELECT indrelid::regclass, indkey, indexrelid::regclass
FROM pg_index
GROUP BY indrelid, indkey
HAVING count(*) > 1;
```

## EXPLAIN-driven checklist

1. `pg_explain` on the query.
2. `Seq Scan` on big table → check `pg_table_info` for a candidate column + create it.
3. `Index Scan` but slow → check the extra `Filter:` line. Those columns belong in INCLUDE.
4. `Bitmap Heap Scan` with `Recheck` → non-heap-resident index. Acceptable; `Index Only Scan` is better.
5. Planner ignoring a fresh index (`rows=1` but still `Seq Scan`) → `ANALYZE table_name` to refresh statistics.
6. Index flagged `invalid` after failed `CONCURRENTLY` → `DROP INDEX CONCURRENTLY idx;` then rebuild.

## Pitfalls

- **`CONCURRENTLY` inside a transaction**: doesn't work. Build outside `BEGIN`.
- **Over-indexing**: every index slows writes. Audit `pg_stat_user_indexes`.
- **Duplicate indexes**: `(a, b)` and `(a)` are near-duplicates. Build composite; drop the prefix-only.
- **FK indexes do NOT auto-create**: unlike MySQL. `FOREIGN KEY (user_id)` does not build an index — make it yourself when you query that column.
- **PK is invisible**: the primary key is a constraint; you still may want separate indexes on other columns.
- **BRIN not for sparse tables**: rows scattered across blocks → BRIN useless.
- **Failure with `CONCURRENTLY`**: leaves `invalid` index. Must drop + rebuild.
