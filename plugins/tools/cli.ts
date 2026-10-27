/** Shared CLI runner for tool modules: exec, trim, map known failures to actionable text. */
export interface CliMapping {
	pattern: RegExp;
	message: string;
}

export interface CliResult {
	ok: boolean;
	text: string;
}

export interface CliHost {
	exec(bin: string, args: string[], options?: { timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
}

export async function runCli(
	pi: CliHost,
	bin: string,
	args: string[],
	{ timeout = 30_000, notFound, mappings = [], keepEmpty = false }: { timeout?: number; notFound: string; mappings?: CliMapping[]; keepEmpty?: boolean },
): Promise<CliResult> {
	const result = await pi.exec(bin, args, { timeout });
	const out = result.stdout.trim();
	if (result.code === 0) return { ok: true, text: keepEmpty ? out : out || "OK" };
	const err = result.stderr.trim() || out;
	if (result.code === 127 || /command not found|ENOENT/.test(err)) {
		return { ok: false, text: notFound };
	}
	for (const mapping of mappings) {
		if (mapping.pattern.test(err)) return { ok: false, text: mapping.message };
	}
	return { ok: false, text: `${bin} ${args[0] ?? ""} failed: ${err || `exit ${result.code}`}` };
}
