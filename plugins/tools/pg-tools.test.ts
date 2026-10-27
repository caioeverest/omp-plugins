import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerPostgresTools } from "./pg-tools.ts";

const ENV_KEYS = ["PGUSER", "PGPASSWORD", "PGHOST", "PGPORT", "PGDATABASE"];
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
	for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
	process.env.PGUSER = "testuser";
	process.env.PGPASSWORD = "secretpw";
	process.env.PGHOST = "127.0.0.1";
	process.env.PGPORT = "5432";
	delete process.env.PGDATABASE;
});

afterAll(() => {
	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}
});

interface ExecCall {
	command: string;
	args: string[];
}

interface ObservedPgpass {
	path: string;
	mode: number;
	content: string;
}

function fakePi() {
	const tools = new Map<string, { execute: (id: string, params: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }> }>();
	const calls: ExecCall[] = [];
	const pgpassFiles: ObservedPgpass[] = [];
	const pi = {
		registerTool: (def: { name: string }) => {
			tools.set(def.name, def as never);
		},
		exec: async (command: string, args: string[]) => {
			const pgpassArg = args.find((arg) => arg.startsWith("PGPASSFILE="));
			if (pgpassArg) {
				const path = pgpassArg.slice("PGPASSFILE=".length);
				pgpassFiles.push({ path, mode: statSync(path).mode & 0o777, content: readFileSync(path, "utf8") });
			}
			calls.push({ command, args });
			return { code: 0, stdout: "ok", stderr: "", killed: false };
		},
	};
	registerPostgresTools(pi as unknown as ExtensionAPI);
	return { tools, calls, pgpassFiles };
}

function textOf(result: { content: Array<{ text: string }> }): string {
	return result.content.map((part) => part.text).join("\n");
}

describe("runPsql credential isolation", () => {
	it("runs through the env wrapper without touching process.env.PGPASSWORD", async () => {
		const { tools, calls, pgpassFiles } = fakePi();
		const before = process.env.PGPASSWORD;
		const result = await tools.get("pg_query")!.execute("id", { sql: "SELECT 1" });

		expect(result.isError).toBeUndefined();
		expect(process.env.PGPASSWORD).toBe(before);
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe("env");
		expect(calls[0].args).toContain("PGOPTIONS=-c default_transaction_read_only=on");

		expect(pgpassFiles).toHaveLength(1);
		expect(pgpassFiles[0].mode).toBe(0o600);
		expect(pgpassFiles[0].content).toBe("*:*:*:testuser:secretpw\n");
		expect(existsSync(dirname(pgpassFiles[0].path))).toBe(false);
	});

	it("omits the read-only default for the approved write tool", async () => {
		const { tools, calls } = fakePi();
		await tools.get("pg_exec")!.execute("id", { sql: "INSERT INTO t VALUES (1)" });
		expect(calls[0].command).toBe("env");
		expect(calls[0].args.some((arg) => arg.startsWith("PGOPTIONS="))).toBe(false);
	});

	it("rejects psql meta-commands on the write tool without executing anything", async () => {
		const { tools, calls } = fakePi();
		const result = await tools.get("pg_exec")!.execute("id", { sql: "\\! whoami" });
		expect(result.isError).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it("refuses statements that hide a write behind comment markers", async () => {
		const { tools, calls } = fakePi();
		const result = await tools.get("pg_query")!.execute("id", { sql: "SELECT '/*'; DROP TABLE t; SELECT '*/'" });
		expect(result.isError).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

describe("pg_table_info SQL construction", () => {
	it("quotes the table name instead of interpolating it raw", async () => {
		const { tools, calls } = fakePi();
		await tools.get("pg_table_info")!.execute("id", { table: "users'; DROP TABLE secrets; --" });
		const sql = calls[0].args[calls[0].args.length - 1];
		expect(sql).toContain("table_name = 'users''; DROP TABLE secrets; --'");
		expect(sql).not.toContain("table_name = users");
		expect(textOf({ content: [{ text: sql }] })).toContain("users");
	});
});
