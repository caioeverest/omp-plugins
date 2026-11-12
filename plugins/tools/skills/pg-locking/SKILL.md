---
name: pg-locking
description: PostgreSQL locking — row locks, advisory locks, deadlock detection, pg_locks vocabulary, lock-wait/blocked-session diagnosis with pg_stat_activity, NOWAIT/SKIP LOCKED. Use when diagnosing lock contention, deadlocks, or long-blocking transactions. Not for general transactional DML and retry patterns (pg-transactions) or query tuning (pg-queries).
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

Full semantics live in `skill://pg-transactions`. What matters for locking:

- **READ COMMITTED** (default) — statement snapshot; a writer blocked by another transaction re-reads and retries its row after that transaction commits. Fewest conflicts.
- **REPEATABLE READ** — updating a row another transaction already updated raises `40001`; the whole transaction retries.
- **SERIALIZABLE** — SSI tracks read+write sets; conflicts abort with `40001`. Expect retries under contention.

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

## Deadlocks

Two transactions each hold a lock the other needs. PG detects the cycle and kills one (`ERROR deadlock detected`).

```sql
-- Tx A                                -- Tx B
BEGIN;                                 BEGIN;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
                                       UPDATE accounts SET balance = balance + 10 WHERE id = 2;
UPDATE accounts SET balance = balance - 10 WHERE id = 2;  -- waits for B
                                       UPDATE accounts SET balance = balance + 10 WHERE id = 1;  -- waits for A → cycle → deadlock
```

### Preventing deadlocks

1. **Consistent lock order** across transactions (sort IDs before updating).
2. **Short transactions** — less overlap.
3. **Index the WHERE clause** on UPDATE/DELETE so only matching rows lock.
4. **Batch in a fixed `ORDER BY`** before updating.
5. **Use `NOWAIT`** for speculative UPDATE paths: `UPDATE ... FOR UPDATE NOWAIT` raises `55P03` instead of waiting.

### After a deadlock

Postgres keeps no deadlock history. The `pg_locks` tool is the live diagnostic — it returns the blocked→blocking pair graph. To capture deadlocks after the fact, set `log_lock_waits=on` and `deadlock_timeout=1s` on the server, then read the Postgres server log (not a table).

## Diagnosing lock waits

Run the `pg_locks` tool — it returns every running backend with wait state plus the blocked→blocking pair graph, for all lock types.

To reproduce the pair graph by hand, join `pg_locks` (not granted) to itself on the lock identity columns (`locktype`, `relation`, `page`, `tuple`, `transactionid`, `classid`, `objid`, `objsubid`) with different PIDs, then join both sides to `pg_stat_activity` for the user and query text.

### Terminate the blocker

```sql
SELECT pg_terminate_backend(<pid>);
```

Run through `pg_exec` (write approval). It aborts the target's transaction and drops its connection — confirm the PID is the real blocker from the pair graph first.

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

App-controlled named locks. `pg_advisory_lock` is **session-scoped** — held until `pg_advisory_unlock` or disconnect. `pg_advisory_xact_lock` is **transaction-scoped** — auto-released at `COMMIT`/`ROLLBACK`. Classic uses: cross-table invariants, leader election within a database.

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

Lock rows in the current transaction. Send the whole block as ONE `pg_exec` call — each call is a fresh `psql` connection, so a transaction cannot span calls (see `skill://pg-transactions`):

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

On a unique index, an equality probe that finds the row takes a tuple lock. An equality probe that finds nothing acquires a transient `transactionid`-based guard, so concurrent inserts of the same not-yet-present value serialize. This is why `INSERT ... ON CONFLICT` (upsert) can deadlock under heavy concurrency — use a pre-created unique index + `ON CONFLICT DO NOTHING` + retry.

## Pitfalls

- **`FOR UPDATE` in autocommit mode**: locks the row then immediately commits. Wrap in `BEGIN ... COMMIT`.
- **DDL takes AccessExclusiveLock**: plain `ALTER TABLE` blocks concurrent `SELECT`. Use `CONCURRENTLY` or schedule.
- **Locks release only at `COMMIT`/`ROLLBACK`**: a failed `UPDATE` inside a transaction keeps its locks until the transaction ends.
- **SELECT doesn't lock**: plain `SELECT` uses MVCC snapshot; only `FOR UPDATE` / `FOR SHARE` / DDL take locks.
- **Long blockers cause cascade**: if transaction A holds a lock and A is itself waiting, everyone queues. Look for chains in the pair graph.
