---
name: pg-queries
description: Write, read, and optimize PostgreSQL SELECT queries — joins, subqueries vs CTEs, aggregation, window functions, EXPLAIN plan reading, and the classic index-defeating patterns. Use when writing SELECTs, reading EXPLAIN output, or diagnosing a slow query. Not for index design (pg-indexes) or lock waits (pg-locking).
---

# PG Queries

Writing good SELECT queries and reading EXPLAIN to find why they're slow.

## Tool usage

- `pg_query` — one read-only statement: a plain `SELECT` or `TABLE`. Rejects `WITH`/CTE, `SELECT INTO`, multi-statement input, and any write (use `pg_exec`).
- `pg_explain` — prepends `EXPLAIN` (or `EXPLAIN (ANALYZE, BUFFERS)` with `analyze: true`) to a plain `SELECT`; `WITH` is rejected, so run a CTE plan as a full `EXPLAIN ...` through `pg_exec`.
- `pg_table_info` — column list + index definitions.

## Query patterns

### Prefer explicit column lists

Avoid `SELECT *`: it forces heap lookups and defeats `Index Only Scan`s. List the columns you need; every extra column makes the planner hit the heap.

### JOIN: drive from the smallest table

The planner picks join order, but give it a leg up: filter the small side first, index the join columns on the other.

```sql
SELECT o.id, o.total, u.email
FROM orders o
JOIN users u ON u.id = o.user_id
WHERE o.created_at >= '2026-01-01' AND o.status = 'paid';
```

Index: `orders(status, created_at)` — composite, equality first. `users.id` is the PK.

### Subquery vs CTE vs JOIN

PG 12+ inlines a non-recursive `WITH` referenced once; recursive or multiply-referenced CTEs still materialize. `MATERIALIZED` forces a single execution:

```sql
-- CTE — MATERIALIZED forces one execution, reused by the join
WITH recent_orders AS MATERIALIZED (
  SELECT user_id, COUNT(*) AS cnt
  FROM orders
  WHERE created_at >= '2026-01-01'
  GROUP BY user_id
)
SELECT u.email, r.cnt
FROM users u JOIN recent_orders r ON r.user_id = u.id
WHERE r.cnt > 5;
```

`MATERIALIZED` pays when the CTE is expensive and referenced twice; otherwise let the planner inline it. A plain JOIN over the same tables gives the planner one unit to optimize.

### Aggregation and GROUP BY

- PG has no `ONLY_FULL_GROUP_BY` toggle: non-aggregated columns must appear in GROUP BY.
- `GROUP BY` sorts; on PG 16+ `enable_incremental_sort` can help. If the planner still picks `Sort`, add the ORDER BY columns to the index.
- Pre-aggregate `COUNT(DISTINCT)` into a summary table when it counts for performance.

### Window functions

Window functions (ranks, lag/lead, running totals) avoid self-joins and beat correlated subqueries.

## Reading EXPLAIN

### Plan node shapes (best to worst)

| node | meaning |
|------|---------|
| `Bitmap Index Scan` → `Bitmap Heap Scan` | collects pages, re-sorted into recheck pass. Good partial coverage. |
| `Index Scan` | row-by-row index hit, then heap fetch |
| `Index Only Scan` | covers everything in the index — no heap |
| `Nested Loop` | small outer driven; per-row inner lookup |
| `Hash Join` | full scan of inner, hash, probe from outer |
| `Merge Join` | both sides sorted, walk both |
| `Seq Scan` | full heap read — fine for small tables, suspect otherwise |

`Seq Scan` on your biggest table is the smell. `Index Scan` it → `Seq Scan`, check why: no usable index, low selectivity, or planner cost misjudged.

### Buffer info (BUFFERS)

`Buffers: shared hit=... read=...` — `hit` is cache, `read` was a disk read. High `read` + low `hit` = slow.

### EXPLAIN ANALYZE

`actual time=... rows=... loops=...` per node. Reveals estimate vs reality:

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 42 AND status = 'paid';
```

Look for `rows: 1000` but actual `rows: 3` — stale statistics. Run `ANALYZE table_name`. The `pg_explain` tool uses `ANALYZE` when you pass `analyze: true`.

## Diagnosing a slow query

1. Run `pg_explain` with `analyze: true`.
2. `Seq Scan` on big table? Check if the leading filter columns exist in an index (`pg_table_info`).
3. `Index Scan` but slow? Check the index filter — extra `Filter:` after the index condition narrows on the heap anyway. Add columns to a covering `INCLUDE` (see pg-indexes).
4. `Sort` or `Hash` spilling? `Buffers: temporary read=...` → `work_mem` too low. `SET work_mem='64MB'` and re-run.
5. JOIN order feels wrong? Run with `EXPLAIN (ANALYZE, BUFFERS)` on each candidate index; the planner will switch when it trusts the rows estimate.
6. Stale `rows` estimate on a recently bulk-loaded table? `ANALYZE table_name`.

## Common pitfalls

- **Implicit type conversion**: `WHERE uuid_col = 'abc-deadbeef'` doesn't use the index when the literal stays text. Cast: `::uuid`.
- **Leading wildcard**: `WHERE col ILIKE '%term%'` cannot use a btree. Use `pg_trgm` GIN, or prefix search `col LIKE 'term%'`.
- **Function on indexed column**: `WHERE date(created_at) = '2026-01-01'` can't use the btree. Range-form: `WHERE created_at >= '2026-01-01' AND created_at < '2026-01-02'`.
- **`ILIKE` / regex**: skips btree. Use `citext` or `LOWER(col) = LOWER(?)` with a functional index.
- **OFFSET pagination**: `LIMIT 20 OFFSET 10000` still reads 10020 rows. Keyset paginate: `WHERE id > $1 ORDER BY id LIMIT 20`.
- **OR across tables**: often forces scan union. Rewrite as `UNION ALL`.
- **CASE in WHERE**: breaks SARGability. Rewrite as an indexable form, or pre-filter in a subquery.
