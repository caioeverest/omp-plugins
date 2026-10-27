import { describe, expect, it } from "bun:test";
import { isReadOnly, pgpassLine, psqlArgv, tableInfoSql, type PgConfig } from "./postgres.ts";

describe("isReadOnly", () => {
	it("accepts a single SELECT or TABLE statement", () => {
		expect(isReadOnly("SELECT 1")).toBe(true);
		expect(isReadOnly("  select * from t where a = 'x'")).toBe(true);
		expect(isReadOnly("TABLE users;")).toBe(true);
	});

	it("rejects writes hidden behind comment markers inside strings", () => {
		expect(isReadOnly("SELECT '/*'; DROP TABLE secrets; SELECT '*/'")).toBe(false);
		expect(isReadOnly("SELECT '--'; DROP TABLE secrets;")).toBe(false);
	});

	it("rejects dollar-quoted and escape-string smuggling", () => {
		// Dollar-quoted content is a literal, so this is genuinely one read-only statement.
		expect(isReadOnly("SELECT $$; DROP TABLE secrets;$$")).toBe(true);
		expect(isReadOnly("SELECT $tag$; DROP TABLE secrets;$tag$")).toBe(true);
		expect(isReadOnly("SELECT $$x$$; DROP TABLE secrets")).toBe(false);
		expect(isReadOnly("SELECT E'\\\\'; DROP TABLE secrets; --")).toBe(false);
	});

	it("keeps semicolons and keywords inside strings harmless", () => {
		expect(isReadOnly("SELECT ';'")).toBe(true);
		expect(isReadOnly("SELECT 'INTO'")).toBe(true);
		expect(isReadOnly('SELECT "INTO;DROP"')).toBe(true);
		expect(isReadOnly("SELECT 'it''s'")).toBe(true);
		expect(isReadOnly("SELECT $1")).toBe(true);
	});

	it("rejects writes, CTEs, SELECT INTO, meta-commands, and multi-statement input", () => {
		expect(isReadOnly("INSERT INTO t VALUES (1)")).toBe(false);
		expect(isReadOnly("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(false);
		expect(isReadOnly("SELECT * INTO new_table FROM t")).toBe(false);
		expect(isReadOnly("\\! whoami")).toBe(false);
		expect(isReadOnly("SELECT 1; SELECT 2")).toBe(false);
		expect(isReadOnly("")).toBe(false);
		expect(isReadOnly("(SELECT 1)")).toBe(false);
	});

	it("handles nested block comments", () => {
		expect(isReadOnly("SELECT 1 /* outer /* inner */ still outer */")).toBe(true);
		expect(isReadOnly("SELECT 1 /* /* */ */ ; DROP TABLE t")).toBe(false);
	});
});

describe("tableInfoSql", () => {
	it("quotes the table name so it cannot terminate the statement", () => {
		const sql = tableInfoSql("users'; DROP TABLE secrets; --");
		expect(sql).toContain("table_name = 'users''; DROP TABLE secrets; --'");
		expect(sql).toContain("tablename = 'users''; DROP TABLE secrets; --'");
		expect(sql).not.toContain("table_name = users");
	});

	it("uses the second segment of a qualified name", () => {
		const sql = tableInfoSql("public.users");
		expect(sql).toContain("table_name = 'users'");
		expect(sql).toContain("tablename = 'users'");
	});
});

describe("pgpassLine", () => {
	it("escapes backslashes and colons per libpq", () => {
		expect(pgpassLine("postgres", "p@ss:word\\x")).toBe("*:*:*:postgres:p@ss\\:word\\\\x");
		expect(pgpassLine("u", "")).toBe("*:*:*:u:");
	});
});

describe("psqlArgv", () => {
	const config: PgConfig = { host: "127.0.0.1", port: 5432, user: "u", password: "", database: "", socket: null };

	it("enforces a read-only transaction default through the env wrapper", () => {
		expect(psqlArgv(config, { readOnly: true })).toEqual([
			"env",
			"PGOPTIONS=-c default_transaction_read_only=on",
			"psql",
			"--no-psqlrc",
			"--no-align",
			"--pset=pager=off",
			"--host",
			"127.0.0.1",
			"--port",
			"5432",
			"--username",
			"u",
		]);
	});

	it("passes the pgpass file path and never a password inline", () => {
		const argv = psqlArgv(config, { pgpassPath: "/tmp/x/.pgpass", database: "app" });
		expect(argv).toContain("PGPASSFILE=/tmp/x/.pgpass");
		expect(argv).not.toContain("PGOPTIONS=-c default_transaction_read_only=on");
		expect(argv).toContain("--dbname");
		expect(argv).toContain("app");
	});
});
