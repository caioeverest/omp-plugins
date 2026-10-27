/** PostgreSQL tools: read-only query, write exec, EXPLAIN, table info, locks, stats. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatResult, isReadOnly, PG_LOCKS_SQL, PG_STATS_SQL, pgpassLine, psqlArgv, readPgConfig, tableInfoSql } from "./postgres.ts";
import { toolText } from "./tool-result.ts";

async function runPsql(
	pi: ExtensionAPI,
	sql: string,
	opts?: { database?: string; timeout?: number; readOnly?: boolean },
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
	let config;
	try {
		config = readPgConfig();
	} catch (e) {
		return { ok: false, stdout: "", stderr: e instanceof Error ? e.message : String(e), code: 1 };
	}

	// The SDK's exec options carry no environment: the password travels in a
	// private .pgpass file referenced through the `env` wrapper instead of a
	// process-wide PGPASSWORD mutation.
	let pgpassDir: string | undefined;
	try {
		let pgpassPath: string | undefined;
		if (config.password) {
			pgpassDir = mkdtempSync(join(tmpdir(), "omp-pgpass-"));
			pgpassPath = join(pgpassDir, ".pgpass");
			writeFileSync(pgpassPath, `${pgpassLine(config.user, config.password)}\n`, { mode: 0o600 });
		}
		const args = [...psqlArgv(config, { database: opts?.database, readOnly: opts?.readOnly, pgpassPath }), "-c", sql];
		const result = await pi.exec("env", args, { timeout: opts?.timeout ?? 30_000 });
		return { ok: result.code === 0, stdout: result.stdout, stderr: result.stderr, code: result.code };
	} finally {
		if (pgpassDir) rmSync(pgpassDir, { recursive: true, force: true });
	}
}

export function registerPostgresTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "pg_query",
		label: "Postgres: Query (read-only)",
		description:
			"Run a read-only SQL query (SELECT, TABLE, WITH) against the Postgres server configured by .omp/agent/pg.json or PG* env vars. " +
			"Write statements are rejected — use pg_exec. " +
			"Optional `database` overrides the default connection database.",
		parameters: {
			type: "object",
			properties: {
				sql: { type: "string", description: "Read-only SQL statement" },
				database: { type: "string", description: "Override default database for this call" },
			},
			required: ["sql"],
			additionalProperties: false,
		},
		approval: "read",
		execute: async (_id, params: { sql: string; database?: string }) => {
			if (!isReadOnly(params.sql)) {
				return toolText(
					"Rejected: pg_query accepts one SELECT or TABLE statement without SELECT INTO. Use pg_exec for writes.",
					true,
				);
			}
			const r = await runPsql(pi, params.sql, { database: params.database, readOnly: true });
			return toolText(formatResult(r).text, !r.ok);
		},
	});

	pi.registerTool({
		name: "pg_exec",
		label: "Postgres: Exec (write)",
		description:
			"Execute a write statement (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE, or any non-read SQL) against the Postgres server configured by .omp/agent/pg.json or PG* env vars. " +
			"For multi-statement transactions, wrap in BEGIN...COMMIT. " +
			"Optional `database` overrides the default connection database.",
		parameters: {
			type: "object",
			properties: {
				sql: { type: "string", description: "SQL statement to execute" },
				database: { type: "string", description: "Override default database for this call" },
			},
			required: ["sql"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: { sql: string; database?: string }) => {
			if (params.sql.trimStart().startsWith("\\")) {
				return toolText(
					"Rejected: psql meta-commands are not supported. Pass plain SQL; use pg_table_info for schema inspection.",
					true,
				);
			}
			const r = await runPsql(pi, params.sql, { database: params.database });
			return toolText(formatResult(r).text, !r.ok);
		},
	});

	pi.registerTool({
		name: "pg_explain",
		label: "Postgres: EXPLAIN",
		description:
			"Run EXPLAIN (optionally EXPLAIN ANALYZE) on a SELECT query and return the plan. " +
			"Use to inspect Seq Scan vs Index Scan, join strategies, sort/aggregate/spill behavior. " +
			"Pass the full SELECT statement; the tool prepends EXPLAIN.",
		parameters: {
			type: "object",
			properties: {
				sql: { type: "string", description: "SELECT statement to explain" },
				analyze: { type: "boolean", description: "Use EXPLAIN ANALYZE for actual row counts and timing" },
				database: { type: "string", description: "Override default database for this call" },
			},
			required: ["sql"],
			additionalProperties: false,
		},
		approval: "read",
		execute: async (_id, params: { sql: string; analyze?: boolean; database?: string }) => {
			if (!isReadOnly(params.sql)) {
				return toolText("Rejected: EXPLAIN target must be a SELECT query.", true);
			}
			const prefix = params.analyze ? "EXPLAIN (ANALYZE, BUFFERS) " : "EXPLAIN ";
			const r = await runPsql(pi, prefix + params.sql, { database: params.database, readOnly: true });
			return toolText(formatResult(r).text, !r.ok);
		},
	});

	pi.registerTool({
		name: "pg_table_info",
		label: "Postgres: Table Info",
		description:
			"Get schema and index details for a table: column list (data types, nulls, defaults) and index definitions. " +
			"Use when designing indexes, reviewing schema, or understanding a table's structure.",
		parameters: {
			type: "object",
			properties: {
				table: { type: "string", description: "Table name (schema.table or table)" },
				database: { type: "string", description: "Override default database for this call" },
			},
			required: ["table"],
			additionalProperties: false,
		},
		approval: "read",
		execute: async (_id, params: { table: string; database?: string }) => {
			const r = await runPsql(pi, tableInfoSql(params.table), { database: params.database, readOnly: true });
			return toolText(formatResult(r).text, !r.ok);
		},
	});

	pi.registerTool({
		name: "pg_locks",
		label: "Postgres: Lock Inspector",
		description:
			"Inspect current Postgres lock activity. Returns running backends with wait state, and the blocked→blocking pair graph. " +
			"Use when diagnosing deadlocks, lock contention, or long-running transactions.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		approval: "read",
		execute: async () => {
			const r = await runPsql(pi, PG_LOCKS_SQL, { timeout: 10_000, readOnly: true });
			return toolText(formatResult(r).text, !r.ok);
		},
	});

	pi.registerTool({
		name: "pg_stats",
		label: "Postgres: Stats",
		description:
			"Collect pg_stat_activity + pg_stat_database in one call: connection counts, per-DB counters, broken-by-state. " +
			"Use as a quick health snapshot before diagnosing slow queries or lock contention.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		approval: "read",
		execute: async () => {
			const r = await runPsql(pi, PG_STATS_SQL, { timeout: 10_000, readOnly: true });
			return toolText(formatResult(r).text, !r.ok);
		},
	});
}
