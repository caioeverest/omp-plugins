import { formatTokens } from "./usage.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CodexWindow {
	usedPercent: number;
	windowMinutes: number;
	resetsAt?: number;
}

export interface CodexCredits {
	hasCredits?: boolean;
	unlimited?: boolean;
	balance?: string;
}

export interface CodexRateLimits {
	primary?: CodexWindow;
	secondary?: CodexWindow;
	credits?: CodexCredits;
	planType?: string;
	capturedAt: string;
}

export interface CodexTokenTotals {
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
	totalTokens: number;
	turns: number;
}

export interface CodexUsageReport {
	codexHome: string;
	sessionFiles: number;
	rateLimits?: CodexRateLimits;
	today: CodexTokenTotals;
	last7Days: CodexTokenTotals;
	thisMonth: CodexTokenTotals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindow(value: unknown): CodexWindow | undefined {
	if (!isRecord(value)) return undefined;
	const usedPercent = finiteNumber(value.used_percent);
	const windowMinutes = finiteNumber(value.window_minutes);
	if (usedPercent === undefined || windowMinutes === undefined) return undefined;
	const resetsAt = finiteNumber(value.resets_at);
	return { usedPercent, windowMinutes, ...(resetsAt === undefined ? {} : { resetsAt }) };
}

function parseRateLimits(value: unknown, capturedAt: string): CodexRateLimits | undefined {
	if (!isRecord(value)) return undefined;
	const primary = parseWindow(value.primary);
	const secondary = parseWindow(value.secondary);
	const creditsValue = isRecord(value.credits) ? value.credits : undefined;
	const credits = creditsValue
		? {
			...(typeof creditsValue.has_credits === "boolean" ? { hasCredits: creditsValue.has_credits } : {}),
			...(typeof creditsValue.unlimited === "boolean" ? { unlimited: creditsValue.unlimited } : {}),
			...(typeof creditsValue.balance === "string" ? { balance: creditsValue.balance } : {}),
		}
		: undefined;
	const planType = typeof value.plan_type === "string" ? value.plan_type : undefined;
	if (!primary && !secondary && !credits && !planType) return undefined;
	return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}), ...(credits ? { credits } : {}), ...(planType ? { planType } : {}), capturedAt };
}

function emptyTotals(): CodexTokenTotals {
	return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, turns: 0 };
}

function addTotals(target: CodexTokenTotals, usage: Record<string, unknown>): void {
	const inputTokens = finiteNumber(usage.input_tokens) ?? 0;
	const outputTokens = finiteNumber(usage.output_tokens) ?? 0;
	const reasoningTokens = finiteNumber(usage.reasoning_output_tokens) ?? 0;
	const totalTokens = finiteNumber(usage.total_tokens) ?? inputTokens + outputTokens;
	target.inputTokens += inputTokens;
	target.outputTokens += outputTokens;
	target.reasoningTokens += reasoningTokens;
	target.totalTokens += totalTokens;
	target.turns += 1;
}

function collectSessionFiles(root: string, files: string[]): void {
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) collectSessionFiles(path, files);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
	}
}

function parseSessionFile(
	filePath: string,
	windows: { dayStart: number; weekStart: number; monthStart: number; today: CodexTokenTotals; last7Days: CodexTokenTotals; thisMonth: CodexTokenTotals },
): CodexRateLimits | undefined {
	let lines: string[];
	try {
		if (statSync(filePath).size === 0) return undefined;
		lines = readFileSync(filePath, "utf8").split("\n");
	} catch {
		return undefined;
	}

	const turns = new Map<string, { timestamp: number; usage: Record<string, unknown> }>();
	let currentTurn = "session";
	let latestRateLimits: CodexRateLimits | undefined;
	for (const line of lines) {
		let record: unknown;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(record) || !isRecord(record.payload)) continue;
		const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
		if (!Number.isFinite(timestamp)) continue;
		const payload = record.payload;
		if (payload.type === "task_started" && typeof payload.turn_id === "string") currentTurn = payload.turn_id;
		if (payload.type !== "token_count" || !isRecord(payload.info)) continue;
		const rateLimits = parseRateLimits(payload.rate_limits, new Date(timestamp).toISOString());
		if (rateLimits) latestRateLimits = rateLimits;
		const totalUsage = isRecord(payload.info.total_token_usage) ? payload.info.total_token_usage : undefined;
		if (totalUsage) turns.set(currentTurn, { timestamp, usage: totalUsage });
	}

	for (const turn of turns.values()) {
		const target = turn.timestamp >= windows.monthStart ? windows.thisMonth : undefined;
		if (!target) continue;
		addTotals(target, turn.usage);
		if (turn.timestamp >= windows.weekStart) addTotals(windows.last7Days, turn.usage);
		if (turn.timestamp >= windows.dayStart) addTotals(windows.today, turn.usage);
	}
	return latestRateLimits;
}

export function collectCodexUsage(codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"), now = new Date()): CodexUsageReport {
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	const report = {
		codexHome,
		sessionFiles: 0,
		today: emptyTotals(),
		last7Days: emptyTotals(),
		thisMonth: emptyTotals(),
	};
	const files: string[] = [];
	collectSessionFiles(join(codexHome, "sessions"), files);
	let latestRateLimits: CodexRateLimits | undefined;
	for (const file of files) {
		const rateLimits = parseSessionFile(file, { dayStart, weekStart, monthStart, ...report });
		if (rateLimits && (!latestRateLimits || rateLimits.capturedAt > latestRateLimits.capturedAt)) latestRateLimits = rateLimits;
	}
	return { ...report, sessionFiles: files.length, ...(latestRateLimits ? { rateLimits: latestRateLimits } : {}) };
}


function formatTotals(label: string, totals: CodexTokenTotals): string {
	return `${label}: ${formatTokens(totals.totalTokens)} total tokens (${formatTokens(totals.inputTokens)} in / ${formatTokens(totals.outputTokens)} out; ${totals.turns} turns)`;
}

function formatWindow(label: string, window: CodexWindow | undefined): string {
	if (!window) return `${label}: unavailable in local session records`;
	const reset = window.resetsAt !== undefined ? `; resets ${new Date(window.resetsAt * 1000).toISOString()}` : "";
	return `${label}: ${window.usedPercent.toFixed(1)}% used over ${window.windowMinutes} minutes${reset}`;
}

export function formatCodexUsage(report: CodexUsageReport, now = new Date()): string {
	const lines = ["# Codex usage", "", `Local session source: ${report.codexHome}`, `Session files scanned: ${report.sessionFiles}`, ""];
	if (report.rateLimits) {
		lines.push(`Plan: ${report.rateLimits.planType ?? "unknown"}`);
		lines.push(formatWindow("Primary window", report.rateLimits.primary));
		lines.push(formatWindow("Secondary window", report.rateLimits.secondary));
		const credits = report.rateLimits.credits;
		if (credits) lines.push(`Credits: ${credits.unlimited ? "unlimited" : credits.hasCredits ? `available (${credits.balance ?? "balance unknown"})` : `none (${credits.balance ?? "balance unknown"})`}`);
		lines.push(`Limit snapshot: ${report.rateLimits.capturedAt}`, "");
	} else {
		lines.push("Account limit snapshot: unavailable in local session records", "");
	}
	lines.push("Local token activity (not an account-limit meter):", formatTotals("Today", report.today), formatTotals("Last 7 days", report.last7Days), formatTotals("This month", report.thisMonth), "", "Authoritative limits: open Settings → Usage or https://chatgpt.com/codex/settings/usage. In an active Codex CLI session, use /status.");
	return lines.join("\n");
}

/** Compact footer status for a native OpenAI/Codex session: plan plus window usage, falling back to today's tokens. */
export function formatCodexStatusLine(report: CodexUsageReport): string {
	const limits = report.rateLimits;
	const parts: string[] = [limits?.planType ? `Codex ${limits.planType}` : "Codex"];
	if (limits?.primary) parts.push(`5h ${Math.round(limits.primary.usedPercent)}%`);
	if (limits?.secondary) parts.push(`wk ${Math.round(limits.secondary.usedPercent)}%`);
	if (parts.length === 1) parts.push(`${formatTokens(report.today.totalTokens)} tok today`);
	return parts.join(" · ");
}
