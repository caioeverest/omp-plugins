/**
 * OMP extension entrypoint for the Telegram bridge.
 *
 * Extension load and `session_start` only register and bind runtime state.
 * They never create files, read a token into model-visible output, or contact
 * Telegram. Only direct local `/telegram setup` or `/telegram connect` starts
 * network polling.
 */

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { rmSync } from "node:fs";
import { basename, join } from "node:path";
import { createTelegramBridge, TELEGRAM_TURN_SYSTEM_PROMPT, type TelegramBridge } from "./bridge.ts";
import { resolveTelegramPaths, type TelegramPaths } from "./state.ts";
import { registerChatTools, TELEGRAM_CHAT_TOOLS } from "./chat-tools.ts";
import { formatCompletions, handleCommand } from "./commands.ts";

export { TELEGRAM_CHAT_TOOLS };
export { TELEGRAM_TURN_SYSTEM_PROMPT };

interface PluginRuntime {
	paths: TelegramPaths;
	bridge: TelegramBridge;
}

/** One bridge per state dir: session switches keep the bot attached to the same live process. */
const runtimes = new Map<string, PluginRuntime>();
let currentPi: ExtensionAPI | undefined;
let sessionCtx: ExtensionContext | undefined;
let reconcileQueued = false;

function bridgeFor(paths: TelegramPaths): TelegramBridge {
	const existing = runtimes.get(paths.stateDir);
	if (existing) return existing.bridge;
	const bridge = createTelegramBridge({
		paths,
		sessionId: "omp",
		sendUserMessage: (content, options) => {
			const pi = currentPi;
			if (!pi) throw new Error("No active OMP session runtime is bound; prompt not delivered.");
			pi.sendUserMessage(content, options);
		},
	});
	runtimes.set(paths.stateDir, { paths, bridge });
	return bridge;
}

function findRuntime(bridge: TelegramBridge): PluginRuntime | undefined {
	for (const runtime of runtimes.values()) {
		if (runtime.bridge === bridge) return runtime;
	}
	return undefined;
}

function seamFrom(ctx: ExtensionContext | undefined) {
	if (!ctx) return undefined;
	return {
		isIdle: () => ctx.isIdle(),
		setInterval: (callback: (...args: unknown[]) => void, ms?: number) => ctx.setInterval(callback, ms),
		clearTimer: (timer: Timer) => ctx.clearTimer(timer),
	};
}

function scheduleReconcile(): void {
	if (!currentPi || reconcileQueued) return;
	reconcileQueued = true;
	queueMicrotask(() => {
		reconcileQueued = false;
		void reconcileChatTools().catch(() => {});
	});
}

/** Advertise chat tools only while connected; remove exactly those names otherwise. */
export async function reconcileChatTools(pi: ExtensionAPI | undefined = currentPi, bridge?: TelegramBridge): Promise<void> {
	if (!pi || typeof pi.getActiveTools !== "function") return;
	const runtime = bridge ? findRuntime(bridge) : undefined;
	const connected = (bridge ?? runtime?.bridge)?.isConnected() ?? false;
	const active = pi.getActiveTools();
	const activeSet = new Set(active);
	const desired = new Set(active);
	for (const name of TELEGRAM_CHAT_TOOLS) {
		if (connected) desired.add(name);
		else desired.delete(name);
	}
	if (desired.size === activeSet.size && [...desired].every((name) => activeSet.has(name))) return;
	await pi.setActiveTools([...desired]);
}

/** Remove a published inbox file; exposed for tests and manual cleanup. */
export function removeInboxFile(paths: TelegramPaths, fileName: string): void {
	rmSync(join(paths.inboxDir, basename(fileName)), { force: true });
}

export default function telegramPlugin(pi: ExtensionAPI): void {
	const agentDir = pi.pi.settings.getAgentDir();
	const paths = resolveTelegramPaths(agentDir);
	currentPi = pi;
	const bridge = bridgeFor(paths);

	registerChatTools(pi, paths, bridge, formatCompletions);

	pi.registerCommand("telegram", {
		description: "Operate the single-owner Telegram bridge: status, setup, connect, disconnect, pair, deny, unpair, clear-token.",
		handler: async (rawArgs: string, ctx) => {
			await handleCommand(rawArgs.trim(), ctx, paths, bridge, scheduleReconcile);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		sessionCtx = ctx;
		scheduleReconcile();
	});

	pi.on("session_switch", (_event, ctx) => {
		sessionCtx = ctx;
		bridge.clearTyping();
		scheduleReconcile();
	});

	pi.on("session_shutdown", () => {
		sessionCtx = undefined;
		void bridge.disconnect().catch(() => {});
	});

	pi.on("before_agent_start", (event, ctx) => {
		scheduleReconcile();
		return bridge.handleBeforeAgentStart(event.prompt, event.systemPrompt, seamFrom(ctx));
	});

	pi.on("agent_end", (event) => {
		void bridge.handleAgentEnd(event.messages, { willContinue: event.willContinue === true });
	});
}
