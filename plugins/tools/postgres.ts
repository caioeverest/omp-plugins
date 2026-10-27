/**
 * PostgreSQL tool helpers for the tools plugin.
 *
 * Tools shell out to the `psql` CLI via `pi.exec` — no native driver, no
 * connection pooling inside the plugin, no deps added. `psql` ships with
 * Postgres itself (and `brew install libpq`), handles auth/SSL via standard
 * env/pgpass, and keeps the plugin surface tiny.
 *
 * Connection config resolution order:
 *   1. `.omp/agent/pg.json` at the repo root (or cwd when not a git repo) —
 *      written by the `/pg-connect` skill.
 *   2. Env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) — fallback
 *      for CI/scripts.
 *   3. Defaults (127.0.0.1:5432, no default database, no socket dir).
 */

import { readDbConfigFile } from "./db-config.ts";

export interface PgConfig {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
	/** Unix socket directory (PGHOST may be a socket directory). */
	socket: string | null;
}

/** Read Postgres connection config: `.omp/agent/pg.json` first, env fallback. Throws if no user is found. */
export function readPgConfig(env: NodeJS.ProcessEnv = process.env): PgConfig {
	const file = readDbConfigFile("pg");
	const user = file.user ?? env.PGUSER ?? "";
	if (!user) {
		throw new Error("missing Postgres user — run /pg-connect to write .omp/agent/pg.json, or set PGUSER");
	}
	return {
		host: file.host ?? env.PGHOST ?? "127.0.0.1",
		port: parsePort(file.port ?? env.PGPORT, 5432),
		user,
		password: file.password ?? env.PGPASSWORD ?? "",
		database: file.database ?? env.PGDATABASE ?? "",
		socket: file.socket ?? null,
	};
}

function parsePort(raw: string | number | undefined, fallback: number): number {
	const s = raw === undefined ? "" : String(raw);
	if (s.trim() === "") return fallback;
	const v = Number.parseInt(s, 10);
	if (!Number.isFinite(v) || v <= 0 || v > 65535) throw new Error(`Postgres port must be 1-65535, got "${s}"`);
	return v;
}

export interface PgExecOptions {
	database?: string;
}

/**
 * Build the CLI arg vector for a `psql` invocation. Host/port wins; when
 * `socket` is set the host is treated as a socket directory (matches psql
 * semantics where host can name a directory containing `.s.PGSQL.<port>`).
 */
export function psqlArgs(config: PgConfig, options: PgExecOptions): string[] {
	const args = ["--no-psqlrc", "--no-align", "--pset=pager=off"];
	if (config.socket) {
		args.push("--host", config.socket);
	} else {
		args.push("--host", config.host, "--port", String(config.port));
	}
	args.push("--username", config.user);
	const db = options.database ?? config.database;
	if (db) args.push("--dbname", db);
	return args;
}

// -------------------------------------------------------------------------
// Read-only classification — guards pg_query from accidental writes.
// -------------------------------------------------------------------------

/**
 * Replace every comment and quoted region with a single space so statement
 * structure survives tokenization. Handles nested block comments, `''`
 * doubling in strings, backslash escapes in `E''` strings, dollar-quoted
 * strings, and `""` identifiers. Removing a span as a space (never nothing)
 * keeps neighbouring tokens from merging.
 */
function stripCommentsAndStrings(sql: string): string {
	const out: string[] = [];
	let i = 0;
	while (i < sql.length) {
		const ch = sql[i];
		const next = sql[i + 1];
		if (ch === "-" && next === "-") {
			while (i < sql.length && sql[i] !== "\n") i += 1;
			out.push(" ");
			continue;
		}
		if (ch === "/" && next === "*") {
			let depth = 1;
			i += 2;
			while (i < sql.length && depth > 0) {
				if (sql[i] === "/" && sql[i + 1] === "*") {
					depth += 1;
					i += 2;
					continue;
				}
				if (sql[i] === "*" && sql[i + 1] === "/") {
					depth -= 1;
					i += 2;
					continue;
				}
				i += 1;
			}
			out.push(" ");
			continue;
		}
		if (ch === "$") {
			const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
			if (tag) {
				const closer = tag[0];
				const end = sql.indexOf(closer, i + closer.length);
				i = end === -1 ? sql.length : end + closer.length;
				out.push(" ");
				continue;
			}
		}
		const escapeString = (ch === "E" || ch === "e") && next === "'";
		if (ch === "'" || escapeString) {
			i += escapeString ? 2 : 1;
			while (i < sql.length) {
				if (escapeString && sql[i] === "\\") {
					i += 2;
					continue;
				}
				if (sql[i] === "'") {
					if (sql[i + 1] === "'") {
						i += 2;
						continue;
					}
					i += 1;
					break;
				}
				i += 1;
			}
			out.push(" ");
			continue;
		}
		if (ch === '"') {
			i += 1;
			while (i < sql.length) {
				if (sql[i] === '"') {
					if (sql[i + 1] === '"') {
						i += 2;
						continue;
					}
					i += 1;
					break;
				}
				i += 1;
			}
			out.push(" ");
			continue;
		}
		out.push(ch);
		i += 1;
	}
	return out.join("");
}

/**
 * True when `sql` is one read-only statement. CTEs and `SELECT INTO` are
 * rejected because they may write data. Multi-statement input, psql
 * meta-commands, and anything not starting with SELECT/TABLE are rejected.
 */
export function isReadOnly(sql: string): boolean {
	const stripped = stripCommentsAndStrings(sql).trim();
	if (stripped.length === 0) return false;
	const withoutTrailingSemicolon = stripped.replace(/;\s*$/, "").trim();
	if (withoutTrailingSemicolon.length === 0 || withoutTrailingSemicolon.includes(";")) return false;
	if (withoutTrailingSemicolon.startsWith("\\")) return false;
	const first = /^([A-Za-z]+)/.exec(withoutTrailingSemicolon);
	const keyword = first?.[1].toUpperCase();
	if (keyword !== "SELECT" && keyword !== "TABLE") return false;
	if (keyword === "SELECT" && /\bINTO\b/i.test(withoutTrailingSemicolon)) return false;
	return true;
}

// -------------------------------------------------------------------------
// Safe SQL construction helpers.
// -------------------------------------------------------------------------

/**
 * information_schema/pg_indexes lookup for one table. The name is embedded as
 * a quoted literal so it can never terminate the statement. A dotted input
 * uses its second segment (matches the historical `schema.table` handling).
 */
export function tableInfoSql(table: string): string {
	const name = table.includes(".") ? table.split(".")[1] ?? "" : table;
	const nameLiteral = `'${name.replaceAll("'", "''")}'`;
	return (
		`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = ${nameLiteral} ORDER BY ordinal_position; ` +
		`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = ${nameLiteral}`
	);
}

// -------------------------------------------------------------------------
// Invocation helpers — credential isolation and read-only enforcement.
// -------------------------------------------------------------------------

/** One libpq `.pgpass` line; wildcard host/port/db match this connection by user only. */
export function pgpassLine(user: string, password: string): string {
	const esc = (value: string) => value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
	return `*:*:*:${esc(user)}:${esc(password)}`;
}

/**
 * Full argv for one `psql` run. `env` isolates secret-adjacent variables to
 * the child process (the SDK exec options carry no environment), PGOPTIONS
 * enforces a read-only transaction default at the server, and the caller
 * appends its own `-c <sql>`.
 */
export function psqlArgv(
	config: PgConfig,
	options: PgExecOptions & { readOnly?: boolean; pgpassPath?: string },
): string[] {
	const argv = ["env"];
	if (options.pgpassPath) argv.push(`PGPASSFILE=${options.pgpassPath}`);
	if (options.readOnly) argv.push("PGOPTIONS=-c default_transaction_read_only=on");
	argv.push("psql", ...psqlArgs(config, options));
	return argv;
}

// -------------------------------------------------------------------------
// Query result formatting.
// -------------------------------------------------------------------------

export interface PgResult {
	ok: boolean;
	text: string;
}

/** Format a psql CLI result for tool output. */
export function formatResult(result: { ok: boolean; stdout: string; stderr: string; code: number }): PgResult {
	if (result.ok) return { ok: true, text: result.stdout.trim() || "(no output)" };
	const err = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
	return { ok: false, text: `psql failed: ${err}` };
}

/** pg_stat_activity blocking graph + raw pg_locks rows. */
export const PG_LOCKS_SQL = `SELECT pid, usename, datname, state, wait_event_type, wait_event, now() - xact_start AS xact_age, left(query, 120) AS query FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY xact_age DESC NULLS LAST; SELECT blocked_locks.pid AS blocked_pid, blocked_activity.usename AS blocked_user, blocking_locks.pid AS blocking_pid, blocking_activity.usename AS blocking_user, left(blocked_activity.query, 80) AS blocked_query, left(blocking_activity.query, 80) AS blocking_query FROM pg_locks blocked_locks JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid JOIN pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid AND blocking_locks.pid <> blocked_locks.pid JOIN pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid WHERE NOT blocked_locks.granted AND blocking_locks.granted`;

/** pg_stat_activity + pg_stat_database snapshot. */
export const PG_STATS_SQL = `SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, temp_files, temp_bytes, deadlocks FROM pg_stat_database WHERE datname NOT IN ('template0','template1'); SELECT state, count(*) FROM pg_stat_activity GROUP BY state; SELECT count(*) AS total, count(*) FILTER (WHERE wait_event IS NOT NULL) AS waiting FROM pg_stat_activity`;
