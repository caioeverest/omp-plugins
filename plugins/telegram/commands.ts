/** Operator /telegram command layer: subcommand dispatch, setup, pairing gates. */
import type { ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { createTelegramApi } from "./telegram-api.ts";
import {
	clearTokenFromEnvFile,
	deleteCursor,
	hasForeignLivePoller,
	readAccessState,
	readCursor,
	readPollerLock,
	readTelegramToken,
	setTokenInEnvFile,
	unpairOwner,
	withStateLock,
	writeAccessState,
	isValidTokenFormat,
	type TelegramPaths,
} from "./state.ts";
import type { TelegramBridge } from "./bridge.ts";

export interface TelegramSubcommand {
	name: string;
	usage: string;
	description: string;
}

export const TELEGRAM_SUBCOMMANDS: TelegramSubcommand[] = [
	{ name: "status", usage: "status", description: "State path, token source, bot identity, connection, owner, pending codes" },
	{ name: "setup", usage: "setup", description: "Prompt for and validate a bot token, save it, and connect" },
	{ name: "connect", usage: "connect", description: "Start polling with the saved token" },
	{ name: "disconnect", usage: "disconnect", description: "Stop polling; token and pairing are preserved" },
	{ name: "pair", usage: "pair <code>", description: "Approve a pending pairing request" },
	{ name: "deny", usage: "deny <code>", description: "Reject a pending pairing request" },
	{ name: "unpair", usage: "unpair --confirm", description: "Clear the owner and all pending requests" },
	{ name: "clear-token", usage: "clear-token --confirm", description: "Disconnect and remove the file-backed token" },
];

/** Model-visible /telegram argument catalog: subcommands, usage, and gates; never pairing codes, tokens, or IDs. */
export function formatCompletions(): string {
	const lines = TELEGRAM_SUBCOMMANDS.map((subcommand) => `  /telegram ${subcommand.usage}: ${subcommand.description}`);
	return [
		"/telegram subcommands (local operator commands; Telegram messages can never trigger them):",
		...lines,
		"pair and deny take a live pending code, which only the local /telegram status command shows.",
	].join("\n");
}

function tokenSourceLabel(paths: TelegramPaths): "environment" | "file" | "missing" {
	const resolved = readTelegramToken(paths);
	if (!resolved) return "missing";
	return resolved.source;
}

export function formatDetailedStatus(paths: TelegramPaths, bridge: TelegramBridge): string {
	const access = readAccessState(paths);
	const status = bridge.getStatus();
	const lines: string[] = [];
	lines.push(`State directory: ${paths.stateDir}`);
	lines.push(`Token source: ${tokenSourceLabel(paths)}`);
	lines.push(`Connected: ${status.connected ? "yes" : "no"}`);
	if (status.botUsername) lines.push(`Bot: @${status.botUsername} (id ${status.botId ?? access.botId ?? "unknown"})`);
	else lines.push(`Paired bot id: ${access.botId ?? "none"}`);
	lines.push(`Last error: ${status.lastError ?? "none"}`);
	if (access.owner) {
		lines.push(`Owner: userId ${access.owner.userId}, chatId ${access.owner.chatId}${access.owner.username ? `, @${access.owner.username}` : ""}${access.owner.displayName ? ` (${access.owner.displayName})` : ""}`);
	} else {
		lines.push("Owner: none");
	}
	const pending = Object.entries(access.pending);
	if (pending.length === 0) {
		lines.push("Pending pairing requests: none");
	} else {
		lines.push("Pending pairing requests:");
		for (const [code, entry] of pending) {
			lines.push(`  ${code}: userId ${entry.userId}, chat ${entry.chatId}, sent ${entry.replies} instruction(s), expires ${new Date(entry.expiresAt).toISOString()}`);
		}
	}
	const lock = readPollerLock(paths);
	if (lock) lines.push(`Poller lock: ownerId ${lock.ownerId}, pid ${lock.pid}, session ${lock.sessionId || "unknown"}`);
	return lines.join("\n");
}

async function present(ctx: ExtensionCommandContext, text: string): Promise<void> {
	if (!ctx.hasUI) {
		console.log(text);
		return;
	}
	await ctx.ui.custom<void>(async (_tui, theme, keybindings, done) => {
		// Lazy UI-only import keeps headless/source-tree command tests dependency-free.
		const { replaceTabs, truncateToWidth } = await import("@oh-my-pi/pi-tui");
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			done(undefined);
		};
		return {
			render(width: number): readonly string[] {
				return [
					theme.fg("accent", "OMP Telegram"),
					"",
					...text.split("\n"),
					"",
					theme.fg("muted", "Press Esc to close"),
				].map((line) => truncateToWidth(replaceTabs(line), width));
			},
			handleInput(data: string): void {
				if (keybindings.matches(data, "app.interrupt")) finish();
			},
		};
	}, { overlay: true });
}

/** One-line operator feedback: toast in the TUI, plain log headless. */
async function presentNote(ctx: ExtensionCommandContext, text: string): Promise<void> {
	if (ctx.hasUI && typeof ctx.ui?.notify === "function") {
		ctx.ui.notify(text, "info");
		return;
	}
	console.log(text);
}

/** Interactive command picker for unknown subcommands; falls back to usage text headless. */
async function presentHelp(ctx: ExtensionCommandContext, paths: TelegramPaths, bridge: TelegramBridge, onReconcile: () => void): Promise<void> {
	const usage = [
		"Usage: /telegram [status|setup|connect|disconnect|pair <code>|deny <code>|unpair --confirm|clear-token --confirm]",
		"Access changes are local-operator commands only; Telegram messages can never trigger them.",
	].join("\n");
	if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
		await present(ctx, usage);
		return;
	}
	const selected = await ctx.ui.select(
		"Telegram bridge",
		TELEGRAM_SUBCOMMANDS.map((subcommand) => ({ label: subcommand.usage, description: subcommand.description })),
	);
	const subcommand = TELEGRAM_SUBCOMMANDS.find((entry) => entry.usage === selected);
	if (!subcommand) return;
	let args = subcommand.name;
	if (subcommand.name === "pair" || subcommand.name === "deny") {
		const code = await ctx.ui.input(`Pairing code to ${subcommand.name}`);
		if (!code || code.trim().length === 0) return;
		args = `${subcommand.name} ${code.trim()}`;
	} else if (subcommand.usage !== subcommand.name) {
		args = subcommand.usage;
	}
	await handleCommand(args, ctx, paths, bridge, onReconcile);
}

export async function handleCommand(rawArgs: string, ctx: ExtensionCommandContext, paths: TelegramPaths, bridge: TelegramBridge, onReconcile: () => void): Promise<void> {
	const [command = "status", ...rest] = rawArgs.split(/\s+/);
	try {
		switch (command) {
			case "status": {
				await present(ctx, formatDetailedStatus(paths, bridge));
				return;
			}
			case "setup": {
				await cmdSetup(ctx, paths, bridge, onReconcile);
				return;
			}
			case "connect": {
				await bridge.connect();
				onReconcile();
				const status = bridge.getStatus();
				await presentNote(ctx, `Connected to Telegram as ${status.botUsername ? `@${status.botUsername}` : `bot ${status.botId}`}.`);
				return;
			}
			case "disconnect": {
				await bridge.disconnect();
				onReconcile();
				await presentNote(ctx, "Disconnected. Token and pairing are preserved.");
				return;
			}
			case "pair": {
				const code = rest[0];
				if (!code) throw new Error("Usage: /telegram pair <code>");
				const owner = await bridge.pair(code);
				onReconcile();
				await presentNote(ctx, `Paired owner ${owner.username ? `@${owner.username}` : owner.userId} (chat ${owner.chatId}). A confirmation was sent on Telegram.`);
				return;
			}
			case "deny": {
				const code = rest[0];
				if (!code) throw new Error("Usage: /telegram deny <code>");
				await bridge.deny(code);
				await presentNote(ctx, `Denied pairing code ${code}.`);
				return;
			}
			case "unpair": {
				if (rest[0] !== "--confirm") throw new Error("Unpairing requires --confirm: /telegram unpair --confirm");
				await withStateLock(paths, () => {
					const current = readAccessState(paths);
					writeAccessState(paths, unpairOwner(current));
				});
				onReconcile();
				await present(ctx, "Unpaired. The owner and all pending requests were cleared; the connected poller observes this on the next update.");
				return;
			}
			case "clear-token": {
				if (rest[0] !== "--confirm") throw new Error("Clearing the token requires --confirm: /telegram clear-token --confirm");
				if (hasForeignLivePoller(paths, "operator")) {
					throw new Error("Another live poller holds poller.lock; refusing to clear credentials under it.");
				}
				await bridge.disconnect();
				onReconcile();
				const removed = clearTokenFromEnvFile(paths);
				const lines = [removed ? "Removed the file-backed token from .env." : "No file-backed token was present."];
				if (process.env.TELEGRAM_BOT_TOKEN !== undefined && process.env.TELEGRAM_BOT_TOKEN.trim().length > 0) {
					lines.push("Warning: TELEGRAM_BOT_TOKEN is still set in the process environment and takes precedence over the file.");
				}
				await present(ctx, lines.join("\n"));
				return;
			}
			default:
				await presentHelp(ctx, paths, bridge, onReconcile);
		}
	} catch (error) {
		await present(ctx, `Telegram command failed: ${bridge.sanitizeError(error)}`);
	}
}

async function cmdSetup(ctx: ExtensionCommandContext, paths: TelegramPaths, bridge: TelegramBridge, onReconcile: () => void): Promise<void> {
	if (!ctx.hasUI) throw new Error("/telegram setup requires local UI. Set TELEGRAM_BOT_TOKEN or edit the .env file manually.");
	if (process.env.TELEGRAM_BOT_TOKEN !== undefined && process.env.TELEGRAM_BOT_TOKEN.trim().length > 0) {
		throw new Error("TELEGRAM_BOT_TOKEN is set in the process environment, which is authoritative and cannot be changed by the plugin. Clear the variable or run /telegram connect to use it.");
	}
	const input = await ctx.ui.input("Telegram bot token", "Paste the BotFather token; it is validated and never displayed again");
	if (input === undefined) throw new Error("Setup cancelled.");
	const token = input.trim();
	if (!isValidTokenFormat(token)) throw new Error("Token does not match the BotFather format '<bot-id>:<secret>' (at least 20 secret characters).");

	// Validate with Telegram before mutating anything.
	const me = await createTelegramApi(token).getMe();
	const access = readAccessState(paths);
	if (access.botId !== undefined && access.botId !== me.id) {
		throw new Error(`Saved state belongs to bot ${access.botId}, but this token identifies bot ${me.id}. Run /telegram unpair --confirm first to release the old bot identity.`);
	}
	if (hasForeignLivePoller(paths, "operator")) {
		throw new Error("Another live poller holds poller.lock; refusing to replace credentials under it.");
	}

	// Validation succeeded: disconnect this runtime, persist the token, accept the new identity.
	await bridge.disconnect();
	setTokenInEnvFile(paths, token);
	const cursor = readCursor(paths);
	if (cursor !== undefined && cursor.botId !== me.id) deleteCursor(paths);
	try {
		await bridge.connect();
		onReconcile();
		await present(ctx, `Saved the token for @${me.username ?? String(me.id)} and connected.`);
	} catch (error) {
		await present(ctx, `The validated token was saved, but reconnect failed and the bridge is stopped: ${error instanceof Error ? error.message : String(error)}`);
	}
}
