/**
 * Shared DB connection config for the PostgreSQL tools.
 *
 * Precedence: `.omp/agent/pg.json` at the repo root (or cwd when not a git
 * repo) > PG* env vars > defaults. The `/pg-connect` skill writes the JSON
 * file; environment variables remain a fallback for CI/scripts.
 *
 * Git root is located by walking up from `startDir` looking for `.git`. No
 * spawning git — deterministic, no shell, no locked-in git version.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface DbConfigFile {
	host?: string;
	port?: number;
	user?: string;
	password?: string;
	database?: string;
	socket?: string | null;
	[key: string]: unknown;
}

/**
 * Find the repository root by walking up from `startDir` looking for a `.git`
 * entry (dir or file — worktrees store a `.git` file). Returns `startDir`
 * (resolved absolute) when no `.git` is found.
 */
export function resolveConfigRoot(startDir: string = process.cwd()): string {
	let dir = resolve(startDir);
	while (true) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(startDir);
		dir = parent;
	}
}

/**
 * Read `.omp/agent/<name>.json`. Returns `{}` when the file does not exist or
 * is malformed — callers fall back to env. Malformed JSON is swallowed on
 * purpose: a broken file shouldn't block the whole plugin.
 */
export function readDbConfigFile(name: string, startDir?: string): DbConfigFile {
	const root = resolveConfigRoot(startDir);
	const path = join(root, ".omp", "agent", `${name}.json`);
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as DbConfigFile;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Path where the connect skills SHOULD write a config file. Exported so the
 * connect skills and runtime read the same location. Does NOT create the
 * file — callers write via the Write tool.
 */
export function dbConfigPath(name: string, startDir?: string): string {
	const root = resolveConfigRoot(startDir);
	return join(root, ".omp", "agent", `${name}.json`);
}

/** Ensure the parent directory of `path` exists. Returns the same path. */
export function ensureDbConfigDir(path: string): string {
	mkdirSync(dirname(path), { recursive: true });
	return path;
}
