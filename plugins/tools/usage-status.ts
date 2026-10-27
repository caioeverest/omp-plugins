/** Model-aware usage status line + codex_usage tool, with 60s managed caching. */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { collectCodexUsage, formatCodexStatusLine, formatCodexUsage, type CodexUsageReport } from "./codex-usage.ts";
import { collectLocalUsage, fetchOpenRouterUsage, formatUsageReport, formatUsageStatusLine, type OpenRouterUsage } from "./usage.ts";
import { toolText } from "./tool-result.ts";

const STATUS_KEY = "usage";
const STATUS_REFRESH_MS = 60_000;

export interface ModelTracker {
	track(ctx: ExtensionContext): void;
	get(): string | undefined;
}

export function createModelTracker(): ModelTracker {
	let currentModelId: string | undefined;
	return {
		track(ctx) {
			if (ctx.model) currentModelId = `${ctx.model.provider}/${ctx.model.id}`;
		},
		get() {
			return currentModelId;
		},
	};
}

export function registerUsageStatusLine(pi: ExtensionAPI, agentDir: string, tracker: ModelTracker): void {
	let openrouterCache: { at: number; data: OpenRouterUsage | undefined } | undefined;
	let openrouterInflight: Promise<OpenRouterUsage | undefined> | undefined;
	let codexCache: { at: number; data: CodexUsageReport } | undefined;
	let statusTimer: unknown;

	async function openRouterUsageCached(): Promise<OpenRouterUsage | undefined> {
		const apiKey = process.env.OPENROUTER_API_KEY;
		if (!apiKey) return undefined;
		const now = Date.now();
		if (openrouterCache && now - openrouterCache.at < STATUS_REFRESH_MS) return openrouterCache.data;
		if (!openrouterInflight) {
			openrouterInflight = fetchOpenRouterUsage(apiKey)
				.then((data) => {
					openrouterCache = { at: Date.now(), data };
					return data;
				})
				.finally(() => {
					openrouterInflight = undefined;
				});
		}
		return openrouterInflight;
	}

	function codexUsageCached(): CodexUsageReport {
		const now = Date.now();
		if (!codexCache || now - codexCache.at >= STATUS_REFRESH_MS) codexCache = { at: now, data: collectCodexUsage() };
		return codexCache.data;
	}

	async function refreshUsageStatus(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI || typeof ctx.ui?.setStatus !== "function") return;
		try {
			const isOpenRouter = tracker.get()?.split("/")[0] === "openrouter";
			const text = isOpenRouter
				? formatUsageStatusLine(await openRouterUsageCached(), collectLocalUsage(agentDir), tracker.get())
				: formatCodexStatusLine(codexUsageCached());
			ctx.ui.setStatus(STATUS_KEY, text);
		} catch {
			// status line is decoration; a failure must never break the session
		}
	}

	pi.on("session_start", (_event, ctx) => {
		tracker.track(ctx);
		if (statusTimer !== undefined) ctx.clearTimer(statusTimer);
		statusTimer = ctx.setInterval(() => void refreshUsageStatus(ctx), STATUS_REFRESH_MS);
		void refreshUsageStatus(ctx);
	});
	pi.on("before_agent_start", (_event, ctx) => {
		tracker.track(ctx);
		void refreshUsageStatus(ctx);
	});
	pi.on("agent_end", (_event, ctx) => {
		tracker.track(ctx);
		void refreshUsageStatus(ctx);
	});
}

export function registerUsageTool(pi: ExtensionAPI, agentDir: string, tracker: ModelTracker): void {
	pi.registerTool({
		name: "codex_usage",
		label: "Usage",
		description:
			"Report LLM usage for the current session provider. When the session model routes through OpenRouter, report OpenRouter key spend plus per-model token buckets from local OMP session files (today, last 7 days, this month). Otherwise (native OpenAI/Codex), report Codex ChatGPT-plan usage from local Codex session records, including the latest 5-hour and weekly rate-limit snapshot when recorded, local token activity, plan, credits, and reset times. Account limits remain authoritative in the provider dashboard (ChatGPT Settings → Usage or an active Codex /status command).",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		approval: "read",
		execute: async () => {
			if (tracker.get()?.split("/")[0] === "openrouter") {
				const apiKey = process.env.OPENROUTER_API_KEY;
				const openrouter = apiKey ? await fetchOpenRouterUsage(apiKey) : undefined;
				return toolText(formatUsageReport(openrouter, collectLocalUsage(agentDir)));
			}
			return toolText(formatCodexUsage(collectCodexUsage()));
		},
	});
}
