---
name: pg-transactions
description: PostgreSQL transactions — BEGIN/COMMIT/ROLLBACK, autocommit, savepoints, ACID guarantees, isolation levels, MVCC, two-phase commit, error handling upserts, idempotency, testing transactions. Use when writing transactional DML, handling errors/rollbacks, or reasoning about consistency and isolation.
---

# PG Transactions

Transaction control, ACID, and patterns for safe writes.

## Tool usage

- `pg_exec` — run `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, DML, DDL.
- `pg_query` — `SELECT current_setting('transaction_isolation')`, `pg_stat_activity` state.
- `pg_locks` — see open transactions and their locks.

## Basic control

```sql
BEGIN;                              -- start transaction
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
UPDATE accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;
-- or ROLLBACK;                     -- undo both
```

### Autocommit

PG defaults to autocommit: each statement is its own transaction. `BEGIN` disables autocommit until `COMMIT` or `ROLLBACK`.

```sql
BEGIN;           -- explicit
-- statements
COMMIT;
```

Prefer explicit `BEGIN ... COMMIT`. Never depend on `SET autocommit=off`-style driver flags unless you own the session.

## ACID

- **Atomicity**: multi-statement tx is all-or-nothing. Crash mid-transaction → undo via WAL replay.
- **Consistency**: constraints (PK, FK, UNIQUE, NOT NULL, CHECK) checked per-statement; a violation aborts the statement, not the whole tx.
- **Isolation**: MVCC for snapshot reads; row locks for writers.
- **Durability**: `synchronous_commit=on` (default) waits for WAL flush. `off` gains throughput and loses the last few ms of commits on crash.

## Savepoints

```sql
BEGIN;
INSERT INTO orders (...) VALUES (...);
SAVEPOINT after_insert;
UPDATE inventory SET stock = stock - 1 WHERE sku = 'X';
ROLLBACK TO SAVEPOINT after_insert;
COMMIT;
```

## Isolation levels

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
```

| level | what you see | when to use |
|-------|--------------|-------------|
| READ COMMITTED (default) | snapshot per statement | most apps |
| REPEATABLE READ | snapshot at first read | consistent reads within tx |
| SERIALIZABLE | SSI-tracked read+write set | provable correctness; aborts conflicts with `40001 could not serialize` |

READ UNCOMMITTED is accepted but treated as READ COMMITTED in PG.

## Write patterns

### Transfer (atomic debit + credit)

```sql
BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
UPDATE accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;
```

`FOR UPDATE` locks the row so the selector can't read a stale balance.

### Upsert (INSERT ... ON CONFLICT)

```sql
INSERT INTO counters (key, value) VALUES ('visits', 1)
ON CONFLICT (key) DO UPDATE SET value = counters.value + 1;
```

Atomic, no race between read-then-write. Needs the unique constraint/index on `key`. **Does NOT take a deadlock-prone gap lock** the way MySQL `ON DUPLICATE KEY UPDATE` sometimes does; safe under concurrency.

### Batch insert in a transaction

```sql
BEGIN;
INSERT INTO logs (msg) VALUES ('a'), ('b'), ('c');
INSERT INTO logs (msg) VALUES ('d'), ('e'), ('f');
COMMIT;
```

One batch in one tx beats autocommit per row by orders of magnitude. Don't make the tx too large — a million rows in one tx bloats WAL and holds locks. 1000-5000 per tx, or `COPY FROM STDIN` for bulk.

## Error handling

A statement error does **not** abort the transaction. Handle explicitly:

```sql
BEGIN;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
-- if this fails (FK violation, check constraint, etc.) the tx stays open
-- decide: continue with a different statement, or ROLLBACK
ROLLBACK;
```

In application code (the `pg_exec` tool runs one statement per call): check the result, issue `ROLLBACK` on error. Don't leave a transaction open.

A serialization conflict in SERIALIZABLE (`40001 could not serialize access`) **aborts the whole tx**. Retry the entire `BEGIN ... COMMIT` block.

## Idempotency

Make transactions safe to retry:

```sql
INSERT INTO transfers (id, from_account, to_account, amount)
VALUES ('tx-abc', 1, 2, 10)
ON CONFLICT (id) DO NOTHING;
RETURNING id;
```

Second execution hits the conflict and does nothing. Pattern: application-level idempotency key as PK or unique constraint.

## What breaks transactions

- **DDL is transactional** (unlike MySQL) — `ALTER TABLE`, `CREATE INDEX`, `DROP TABLE` can appear inside `BEGIN ... COMMIT` and roll back together. This is a PG strength.
- **`CREATE INDEX CONCURRENTLY` is NOT transactional** — must run outside `BEGIN`. It leaves an invalid index on failure.
- **Connection close**: an open transaction rolls back when the connection drops (same as MySQL).
- **`SAVEPOINT` survival**: savepoints survive DDL in PG (DDL is transactional), unlike MySQL.

## Two-phase commit (advanced)

For distributed transactions — rarely needed:

```sql
BEGIN;
UPDATE ...;
PREPARE TRANSACTION 'gid-abc';
-- later, on the coordinator:
COMMIT PREPARED 'gid-abc';
```

Avoid unless you drive a distributed consensus.

## Testing transactions

```sql
BEGIN;
INSERT INTO users (email) VALUES ('test@example.com');
SELECT count(*) FROM users WHERE email = 'test@example.com';  -- expect 1 via pg_query
ROLLBACK;
```

Self-cleaning, no fixture pollution. DROP the BEGIN/ROLLBACK and you've polluted the DB.

## Pitfalls

- **`FOR UPDATE` outside `BEGIN`**: statement locks then commits immediately. Losses the lock.
- **Long transactions pin WAL**: vacuum can't collect dead tuples newer than the oldest transaction's snapshot. Monitor `pg_stat_activity.backend_xmin`.
- **Implicit COMMIT absent in PG**: `ALTER TABLE` is inside the transaction. Both a feature and a hazard — don't mix DDL and DML expecting isolation.
- **SERIALIZABLE can abort**: `40001` is a permanent-seeming error; retry the transaction pattern. Don't catch and suppress without retry.
- **DDL + `CONCURRENTLY`**: `CREATE INDEX CONCURRENTLY` cannot run inside `BEGIN`. Build outside.
- **`RETURNING` matters**: `INSERT ... ON CONFLICT DO NOTHING` in a retry returns zero rows; add `RETURNING` to know whether it actually inserted.
