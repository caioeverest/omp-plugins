import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Usage reporting for the tools plugin, modeled on the fbr base plugin's
 * usage.ts (upstream not verified; see ATTRIBUTION.md). Two sources:
 *
 * - OpenRouter key endpoint (GET /api/v1/key) — authoritative all-time key
 *   spend in USD and the optional credit limit. Fetched only when the session
 *   model routes through OpenRouter and OPENROUTER_API_KEY is set.
 * - Local omp session files under <agentDir>/sessions — per-model token
 *   buckets for today / last 7 days / current month. Tokens are exact; $ is
 *   shown only for models that record a cost.
 */

export interface OpenRouterUsage {
	label?: string;
	spentUsd: number;
	limitUsd?: number;
	freeTier: boolean;
}

export interface ModelBucket {
	model: string;
	costUsd: number;
	tokens: number;
	requests: number;
}

export interface LocalUsage {
	today: ModelBucket[];
	week: ModelBucket[];
	month: ModelBucket[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Fetch the OpenRouter key usage snapshot. Returns undefined on any failure. */
export async function fetchOpenRouterUsage(apiKey: string): Promise<OpenRouterUsage | undefined> {
	let res: Response;
	try {
		res = await fetch("https://openrouter.ai/api/v1/key", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(5000),
		});
	} catch {
		return undefined;
	}
	if (!res.ok) return undefined;

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		return undefined;
	}
	if (!isRecord(data) || !isRecord(data.data)) return undefined;
	const key = data.data;
	const limit = key.limit;
	return {
		label: typeof key.label === "string" ? key.label : undefined,
		spentUsd: numberOr(key.usage, 0),
		limitUsd: typeof limit === "number" && Number.isFinite(limit) ? limit : undefined,
		freeTier: key.is_free_tier === true,
	};
}

/** Aggregate per-model usage from omp session files under <agentDir>/sessions. */
export function collectLocalUsage(agentDir: string, now: Date = new Date()): LocalUsage {
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

	const today = new Map<string, ModelBucket>();
	const week = new Map<string, ModelBucket>();
	const month = new Map<string, ModelBucket>();

	const sessionsDir = join(agentDir, "sessions");
	let projects: Dirent[];
	try {
		projects = readdirSync(sessionsDir, { withFileTypes: true });
	} catch {
		return { today: [], week: [], month: [] };
	}

	for (const project of projects) {
		if (!project.isDirectory()) continue;
		const projectDir = join(sessionsDir, project.name);
		let files: Dirent[];
		try {
			files = readdirSync(projectDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
			const filePath = join(projectDir, file.name);
			try {
				// Prefilter: untouched since before the month started → nothing to add.
				if (statSync(filePath).mtimeMs < monthStart) continue;
				ingestFile(filePath, { dayStart, weekStart, monthStart, today, week, month });
			} catch {
				continue;
			}
		}
	}

	const sortDesc = (buckets: ModelBucket[]): ModelBucket[] => buckets.sort((a, b) => b.tokens - a.tokens);
	return { today: sortDesc([...today.values()]), week: sortDesc([...week.values()]), month: sortDesc([...month.values()]) };
}

interface Windows {
	dayStart: number;
	weekStart: number;
	monthStart: number;
	today: Map<string, ModelBucket>;
	week: Map<string, ModelBucket>;
	month: Map<string, ModelBucket>;
}

function ingestFile(filePath: string, windows: Windows): void {
	const content = readFileSync(filePath, "utf8");
	for (const line of content.split("\n")) {
		if (!line.includes('"usage"')) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(entry) || !isRecord(entry.message)) continue;
		const { message } = entry;
		if (!isRecord(message.usage)) continue;

		const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
		if (!Number.isFinite(timestamp) || timestamp < windows.monthStart) continue;

		const usage = message.usage;
		const cost = isRecord(usage.cost) ? numberOr(usage.cost.total, 0) : 0;
		const tokens = numberOr(usage.totalTokens, numberOr(usage.input, 0) + numberOr(usage.output, 0));
		const provider = typeof message.provider === "string" ? `${message.provider}/` : "";
		const model = `${provider}${typeof message.model === "string" ? message.model : "unknown"}`;

		const targets = [windows.month];
		if (timestamp >= windows.weekStart) targets.push(windows.week);
		if (timestamp >= windows.dayStart) targets.push(windows.today);
		for (const target of targets) {
			const bucket = target.get(model) ?? { model, costUsd: 0, tokens: 0, requests: 0 };
			bucket.costUsd += cost;
			bucket.tokens += tokens;
			bucket.requests += 1;
			target.set(model, bucket);
		}
	}
}

export function formatUsd(value: number): string {
	return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
	if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
	return String(Math.round(value));
}

function formatBucketRows(buckets: ModelBucket[]): string[] {
	if (buckets.length === 0) return ["  (no usage recorded)"];
	const width = Math.max(...buckets.map((bucket) => bucket.model.length));
	return buckets.map((bucket) => {
		const cost = bucket.costUsd > 0 ? formatUsd(bucket.costUsd) : "—";
		return `  ${bucket.model.padEnd(width)}  ${cost.padStart(8)}  ${formatTokens(bucket.tokens).padStart(7)} tok  ${String(bucket.requests).padStart(6)} req`;
	});
}

/** Usage report for an OpenRouter-routed session: key spend + local per-model buckets. */
export function formatUsageReport(openrouter: OpenRouterUsage | undefined, local: LocalUsage): string {
	const lines: string[] = ["# Usage", ""];
	if (openrouter) {
		lines.push("## OpenRouter key", "");
		const label = openrouter.label ? ` (${openrouter.label})` : "";
		lines.push(
			openrouter.limitUsd !== undefined
				? `Spend: ${formatUsd(openrouter.spentUsd)} of ${formatUsd(openrouter.limitUsd)} limit (${((openrouter.spentUsd / openrouter.limitUsd) * 100).toFixed(1)}% used)`
				: `Spend: ${formatUsd(openrouter.spentUsd)} (no credit limit set)`,
		);
		if (openrouter.freeTier) lines.push("Free tier key.");
		if (label) lines.push(`Key label:${label}`);
	} else {
		lines.push(
			"## OpenRouter key",
			"",
			"(unavailable — OPENROUTER_API_KEY missing or OpenRouter unreachable)",
		);
	}
	lines.push(
		"",
		"## Local sessions (per model)",
		"",
		"Tokens are exact. $ is shown for priced models; zero-priced or unrecorded costs show —. The authoritative OpenRouter spend is the key section above.",
		"",
		"Today:",
		"",
		...formatBucketRows(local.today),
		"",
		"Last 7 days:",
		"",
		...formatBucketRows(local.week),
		"",
		"This month:",
		"",
		...formatBucketRows(local.month),
	);
	return lines.join("\n");
}

/** Compact footer status for an OpenRouter-routed session: key spend plus the current model's token bucket. */
export function formatUsageStatusLine(
	openrouter: OpenRouterUsage | undefined,
	local: LocalUsage,
	currentModelId: string | undefined,
): string {
	const bucket = currentModelId ? local.today.find((entry) => entry.model === currentModelId) : undefined;
	const tokens = bucket ? bucket.tokens : local.today.reduce((sum, entry) => sum + entry.tokens, 0);
	const spend = openrouter
		? openrouter.limitUsd !== undefined
			? `${formatUsd(openrouter.spentUsd)}/${formatUsd(openrouter.limitUsd)}`
			: formatUsd(openrouter.spentUsd)
		: "n/a";
	return `OpenRouter ${spend} · ${formatTokens(tokens)} tok today`;
}
