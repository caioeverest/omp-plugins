---
name: pg-locking
description: PostgreSQL locking — row locks, advisory locks, deadlock detection, pg_locks vocabulary, isolation levels, diagnosing with pg_stat_activity, NOWAIT/SKIP LOCKED. Use when diagnosing lock contention, deadlocks, long transactions, or choosing isolation levels.
---

# PG Locking

Postgres MVCC + lock semantics: what locks, when, and how to diagnose contention.

## Tool usage

- `pg_locks` — `pg_stat_activity` (waits + backends) + blocked→blocking pair graph in one call.
- `pg_query` — `SELECT * FROM pg_locks WHERE NOT granted`, `pg_stat_activity` filters.
- `pg_exec` — `SELECT pg_terminate_backend(<pid>)` to end a stuck session.

## Lock types

| locktype | scope | purpose |
|----------|-------|---------|
| `relation` | a table or index | DDL + `LOCK TABLE` |
| `transactionid` | your current tx | self-serialization, conflicts on writers |
| `virtual` | virtual-XID on tx start | internal |
| `tuple` | one row | UPDATE/DELETE conflict |
| `page`/`object`/`userlock` | split or named | rare (page splits, named advisory) |
| `advisory` | explicit | app-level coordination (`pg_advisory_lock`) |

`mode` from least to most intrusive: `AccessShareLock` < `RowShareLock` < `RowExclusiveLock` < `ShareUpdateExclusiveLock` < `ShareLock` < `ShareRowExclusiveLock` < `ExclusiveLock` < `AccessExclusiveLock`. DDL takes `AccessExclusiveLock` = blocks plain `SELECT`.

## Isolation levels

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

| level | reads | phantoms? | serialization? |
|-------|-------|-----------|----------------|
| READ UNCOMMITTED | (PG treats as RC) | yes | no |
| READ COMMITTED (default) | statement snapshot | yes | no |
| REPEATABLE READ | transaction snapshot | no (PG detects + prevents) | no |
| SERIALIZABLE | strict read set + write set tracking | no | yes (SSI) |

**READ COMMITTED** is the standard choice — fewest conflicts, most apps tolerate it. **REPEATABLE READ** for read-consistent reports inside one transaction. **SERIALIZABLE** when you need provable correctness under concurrency (SSI aborts conflicting writes with `40001 could not serialize`).

## Deadlocks

Two transactions each hold a lock the other needs. PG detects the cycle and kills one (`ERROR deadlock detected`).

```sql
-- Tx A                    -- Tx B
BEGIN;                    BEGIN;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;  -- lock id=1
-- Tx B
UPDATE accounts SET balance = balance + 10 WHERE id = 2;  -- lock id=2
-- Tx A continues with id=2 → waits for B
-- Tx B continues with id=1 → waits for A → deadlock
```

### Preventing deadlocks

1. **Consistent lock order** across transactions (sort IDs before updating).
2. **Short transactions** — less overlap.
3. **Index the WHERE clause** on UPDATE/DELETE so only matching rows lock.
4. **Use READ COMMITTED** if your logic tolerates — fewer conflicts.
5. **Batch in a fixed ORDER**: `ORDER BY id` BEFORE updating.
6. **Use `nowait`** for speculative UPDATE paths: `UPDATE ... FOR UPDATE NOWAIT` raises `55P03` instead of waiting.

### After a deadlock

`pg_locks` tool returns the latest pair graph. Query the log for the deadlock detail:

```sql
SELECT log FROM pg_tab_log -- Postgres doesn't keep this; check the server log:
-- log_lock_waits=on + log_deadlock=on, then grep the postgres log.
-- The pg_locks tool query already returns the pair pattern as of right now.
```

Postgres doesn't keep a deadlock history — add `log_lock_waits=on` and `deadlock_timeout=1s` to capture. The blocked→blocking pair query in `pg_locks` tool is the diagnostic.

## Diagnosing lock waits

```sql
-- One-shot: pg_locks tool
-- Or manually:
SELECT blocked_locks.pid AS blocked_pid,
       blocking_locks.pid AS blocking_pid,
       blocked_activity.usename,
       left(blocked_activity.query, 80) AS blocked_query,
       left(blocking_activity.query, 80) AS blocking_query
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_locks blocking_locks
  ON blocking_locks.locktype = blocked_locks.locktype
 AND blocking_locks.locktype = 'transactionid'
 AND blocking_locks.pid <> blocked_locks.pid
 AND NOT blocked_locks.granted
JOIN pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid;
```

The `pg_locks` tool runs both `pg_stat_activity` and this pair graph.

### Terminate the blocker

```sql
SELECT pg_terminate_backend(<pid>);
```

## Long-running transactions

```sql
SELECT pid, usename, state, now() - xact_start AS xact_age, left(query, 80)
FROM pg_stat_activity
WHERE xact_start < now() - interval '60 seconds'
ORDER BY xact_start;
```

Long transactions pin WAL, prevent vacuum, bloat dead tuples. Terminate and fix the app.

## Advisory locks

```sql
SELECT pg_advisory_lock(<big-int-key>);
...critical section...
SELECT pg_advisory_unlock(<big-int-key>);
```

App-controlled named locks. **Session-scoped by default** — released on `COMMIT` if called as `pg_advisory_xact_lock()`. Classic uses: cross-table invariants, leader election within a database.

## SKIP LOCKED

Perfect for work queues:

```sql
SELECT id FROM job_queue
WHERE status = 'pending'
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED;
```

Returns the 10 unlocked pending rows instantly, without blocking on row locks held by other workers.

## SELECT ... FOR UPDATE

Lock rows in the current transaction:

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
COMMIT;
```

- `FOR SHARE` → other txs read, not write.
- `FOR UPDATE NOWAIT` → raises immediately instead of blocking.
- `FOR UPDATE OF accounts` (table alias) when the row comes from a joined table.

## Gap locks / unique checks

On a unique index, an equality probe that finds the row takes a tuple lock. An equality probe that finds nothing takes a gap guard via transaction-id — concurrent inserts racing for the same value sequence-block. This is why `INSERT ... ON CONFLICT` (upsert) can deadlock under heavy concurrency — use a pre-created unique index + `ON CONFLICT DO NOTHING` + retry.

## Pitfalls

- **`FOR UPDATE` in autocommit mode**: locks the row then immediately commits. Wrap in `BEGIN ... COMMIT`.
- **DDL takes AccessExclusiveLock**: plain `ALTER TABLE` blocks concurrent `SELECT`. Use `CONCURRENTLY` or schedule.
- **Implicit unlock on `ROLLBACK`**: locks stay until commit or abort. A failed `UPDATE` inside a transaction holds its locks until `ROLLBACK`.
- **SELECT doesn't lock**: plain `SELECT` uses MVCC snapshot; only `FOR UPDATE` / `FOR SHARE` / DDL take locks.
- **Long blockers cause cascade**: if transaction A holds a lock and A is itself waiting, everyone queues. Look for chains in the pair graph.
