---
name: pg-transactions
description: PostgreSQL transactions — one-call BEGIN/COMMIT/ROLLBACK via pg_exec, autocommit, savepoints, ACID, isolation levels, upsert/idempotency patterns, and retrying 40001. Use when writing transactional DML, handling rollback or error recovery, or reasoning about consistency and isolation. Not for lock-contention diagnosis (pg-locking) or query tuning (pg-queries).
---

# PG Transactions

Transaction control, ACID, and patterns for safe writes.

## Tool usage

- `pg_exec` — send the WHOLE transaction (`BEGIN; ...; COMMIT;`) in ONE call. Each call is a fresh `psql` process, so a transaction cannot span calls; `pg_exec` asks for write approval.
- `pg_query` — one read-only statement: `SELECT current_setting('transaction_isolation')`, `pg_stat_activity` rows.
- `pg_locks` — open transactions and their locks.

## Basic control

Send the block as ONE `pg_exec` call:

```sql
BEGIN;                              -- start transaction
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
UPDATE accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;
-- or ROLLBACK;                     -- undo both
```

### Autocommit

PG defaults to autocommit: each statement is its own transaction. `BEGIN` disables it until `COMMIT` or `ROLLBACK`. Prefer the explicit `BEGIN ... COMMIT` above; never depend on `SET autocommit=off`-style driver flags unless you own the session.

Also: a single `pg_exec` string with several statements (`INSERT ...; INSERT ...;`) is executed by psql as ONE transaction even without `BEGIN`, so it commits or rolls back atomically. An explicit `BEGIN ... COMMIT` makes that intent readable.

## ACID

- **Consistency**: constraints (PK, FK, UNIQUE, NOT NULL, CHECK) are checked per statement; a violation rolls back that statement, leaving the transaction open (aborted) — see Error handling.
- **Durability**: `synchronous_commit=on` (default) waits for WAL flush. `off` gains throughput and loses the last few ms of commits on crash.
- **Atomicity / Isolation**: multi-statement tx is all-or-nothing over WAL; MVCC snapshot reads, row locks for writers.

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
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
UPDATE accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;
```

For a read-then-write check, add `SELECT ... FOR UPDATE` to lock the row (see `skill://pg-locking`).

### Upsert (INSERT ... ON CONFLICT)

```sql
INSERT INTO counters (key, value) VALUES ('visits', 1)
ON CONFLICT (key) DO UPDATE SET value = counters.value + 1;
```

Atomic, no race between read-then-write. Needs the unique constraint/index on `key`. No MySQL-style gap lock, but concurrent inserts of the same key can still race on the unique check — retry on `deadlock detected` or `40001`.

### Batch insert

Batch rows into one call instead of one statement per row — orders of magnitude fewer round-trips. Keep a block to ~1000–5000 rows (larger bloats WAL and holds locks), or use `COPY` for bulk.

## Error handling

Inside one `pg_exec` block, a statement error aborts the rest of the block; the transaction is left aborted (`25P02`) and the connection close rolls it back. So a failed block is a full rollback — not a partial one — unless you fence the risky statement with a savepoint (see Savepoints above) and `ROLLBACK TO SAVEPOINT` when it under-delivers.

`pg_exec` returns psql's stderr, so read the error, fix the block, and resend the whole thing.

A serialization conflict in SERIALIZABLE (`40001 could not serialize access`) aborts the whole transaction. Retry the entire `BEGIN ... COMMIT` block from the application.

## Idempotency

Make a transaction safe to retry by keying it on an idempotency value:

```sql
INSERT INTO transfers (id, from_account, to_account, amount)
VALUES ('tx-abc', 1, 2, 10)
ON CONFLICT (id) DO NOTHING;
```

A second execution hits the conflict and does nothing. The key is a PK or unique constraint; add `RETURNING` to learn whether a row was actually inserted.

## What breaks transactions

- **DDL is transactional** (unlike MySQL) — `ALTER TABLE`, `CREATE INDEX`, `DROP TABLE` can appear inside `BEGIN ... COMMIT` and roll back together. This is a PG strength.
- **`CREATE INDEX CONCURRENTLY` is NOT transactional** — must run outside `BEGIN`. It leaves an invalid index on failure.
- **Connection close**: every `pg_exec` call closes its connection, so an open transaction rolls back between calls. Keep a transaction inside one call; only prepared transactions (2PC) outlive the connection.

## Two-phase commit (advanced)

For distributed transactions — rarely needed. Requires `max_prepared_transactions > 0` on the server:

```sql
BEGIN;
UPDATE ...;
PREPARE TRANSACTION 'gid-abc';
-- later, on the coordinator:
COMMIT PREPARED 'gid-abc';
```

A prepared transaction survives the connection closing, making this the one transaction form that legitimately spans `pg_exec` calls. Avoid unless you drive a distributed consensus.

## Testing transactions

One `pg_exec` call, ending in `ROLLBACK`, leaves the database untouched:

```sql
BEGIN;
INSERT INTO users (email) VALUES ('test@example.com');
ROLLBACK;
```

Self-cleaning, no fixture pollution — the connection close rolls the block back even if a statement fails. Drop the `BEGIN`/`ROLLBACK` and you've polluted the DB.

## Pitfalls

- **`FOR UPDATE` with no `BEGIN`**: the statement locks the row, then the implicit commit releases it. Wrap it in `BEGIN ... COMMIT`.
- **Long transactions pin WAL**: vacuum can't collect dead tuples newer than the oldest transaction's snapshot. Monitor `pg_stat_activity.backend_xmin`.
- **No implicit COMMIT**: DDL joins the transaction, so a `CREATE`/`ALTER` in the block rolls back with the rest. Don't expect a partial commit from mixing DDL and DML.
- **SERIALIZABLE can abort**: `40001` is a permanent-seeming error; retry the transaction pattern. Don't catch and suppress without retry.
- **DDL + `CONCURRENTLY`**: `CREATE INDEX CONCURRENTLY` cannot run inside `BEGIN`. Build outside.
- **`RETURNING` matters**: `INSERT ... ON CONFLICT DO NOTHING` in a retry returns zero rows; add `RETURNING` to know whether it actually inserted.
