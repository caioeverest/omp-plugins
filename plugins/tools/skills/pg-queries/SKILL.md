---
name: pg-queries
description: Writing, reading, and optimizing PostgreSQL queries — SELECT patterns, joins, subqueries vs CTEs, aggregation, EXPLAIN reading, Seq Scan vs Index Scan detection, covering indexes (INCLUDE). Use when writing SELECT queries, reading EXPLAIN output, or diagnosing slow queries.
---

# PG Queries

Writing good SELECT queries and reading EXPLAIN to find why they're slow.

## Tool usage

- `pg_query` — run read-only SELECT/TABLE/WITH. Write statements rejected.
- `pg_explain` — EXPLAIN or EXPLAIN ANALYZE a SELECT. `analyze: true` runs with `BUFFERS`.
- `pg_table_info` — column list + index definitions.

## Query patterns

### Prefer explicit column lists

```sql
-- Good
SELECT id, email, created_at FROM users WHERE active;

-- Bad — schema drift + forces heap lookups past the index
SELECT * FROM users WHERE active;
```

`SELECT *` also defeats `Index Only Scan`s. List what you need; every extra column forces the planner to hit the heap.

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

PG 12+ materializes a CTE (`WITH`) by default; `< 12` folded it for a single use, 12+ lets you control it explicitly:

```sql
-- CTE — materialize explicitly to force one exec
WITH recent_orders AS MATERIALIZED (
  SELECT user_id, COUNT(*) AS cnt
  FROM orders
  WHERE created_at >= '2026-01-01'
  GROUP BY user_id
)
SELECT u.email, r.cnt
FROM users u JOIN recent_orders r ON r.user_id = u.id
WHERE r.cnt > 5;

-- Equivalent JOIN — the planner sees it as one unit
SELECT u.email, COUNT(o.id) AS cnt
FROM users u
JOIN orders o ON o.user_id = u.id
WHERE o.created_at >= '2026-01-01'
GROUP BY u.id
HAVING COUNT(o.id) > 5;
```

`MATERIALIZED` is useful when the CTE is expensive and referenced twice; otherwise let the planner inline.

### Aggregation and GROUP BY

- `ONLY_FULL_GROUP_BY` behavior is built in — non-aggregated columns must appear in GROUP BY. No toggle.
- `GROUP BY` sorts; on PG 16+ there's `enable_incremental_sort`. If the planner still picks `Sort`, add the ORDER BY columns to the index.
- `COUNT(DISTINCT)` — pre-aggregate on a summary table when it matters.

### Window functions

```sql
SELECT
  user_id, amount,
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC) AS rn
FROM orders;
```

Window functions avoid self-joins for ranks, lag/lead, running totals. Faster than correlated subqueries.

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
- **CASE in WHERE**: breaks SARGability. Move CASE inside an indexable form, or filter in `WITH`.
