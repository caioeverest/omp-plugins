import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCodexUsage } from "./codex-usage.ts";

const dirs: string[] = [];

function fixture(lines: object[]): string {
	const home = mkdtempSync(join(tmpdir(), "codex-usage-"));
	dirs.push(home);
	const sessions = join(home, "sessions");
	mkdirSync(sessions, { recursive: true });
	writeFileSync(join(sessions, "rollout.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n"));
	return home;
}

function noon(): Date {
	const now = new Date();
	now.setHours(12, 0, 0, 0);
	return now;
}

function ts(now: Date, minutesAgo: number): string {
	return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("collectCodexUsage", () => {
	it("sums per-turn usage, not cumulative session totals", () => {
		const now = noon();
		const home = fixture([
			{ timestamp: ts(now, 120), payload: { type: "task_started", turn_id: "t1" } },
			{
				timestamp: ts(now, 119),
				payload: {
					type: "token_count",
					info: {
						total_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 },
						last_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 },
					},
				},
			},
			{ timestamp: ts(now, 60), payload: { type: "task_started", turn_id: "t2" } },
			{
				timestamp: ts(now, 59),
				payload: {
					type: "token_count",
					info: {
						total_token_usage: { input_tokens: 2300, output_tokens: 200, total_tokens: 2500 },
						last_token_usage: { input_tokens: 1400, output_tokens: 100, total_tokens: 1500 },
					},
				},
			},
		]);
		const report = collectCodexUsage(home, now);
		expect(report.today.totalTokens).toBe(2500);
		expect(report.today.inputTokens).toBe(2300);
		expect(report.today.turns).toBe(2);
	});

	it("falls back to cumulative deltas when last_token_usage is absent", () => {
		const now = noon();
		const home = fixture([
			{ timestamp: ts(now, 30), payload: { type: "task_started", turn_id: "t1" } },
			{
				timestamp: ts(now, 29),
				payload: { type: "token_count", info: { total_token_usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } } },
			},
			{ timestamp: ts(now, 20), payload: { type: "task_started", turn_id: "t2" } },
			{
				timestamp: ts(now, 19),
				payload: { type: "token_count", info: { total_token_usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } } },
			},
		]);
		const report = collectCodexUsage(home, now);
		expect(report.today.totalTokens).toBe(150);
		expect(report.today.turns).toBe(2);
	});
});
