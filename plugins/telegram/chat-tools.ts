/** Model-visible chat tools, activated only while the bridge is connected. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { normalizeReactionEmoji, resolveOutboundFile } from "./telegram-api.ts";
import type { TelegramBridge } from "./bridge.ts";
import type { TelegramPaths } from "./state.ts";

export const TELEGRAM_CHAT_TOOLS = ["telegram_send", "telegram_edit_message", "telegram_react", "telegram_download_attachment"] as const;

export function toolText(text: string, isError = false): { content: Array<{ type: "text"; text: string }>; isError?: boolean } {
	return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

export function toolError(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
	return { content: [{ type: "text", text: message }], isError: true };
}

const SEND_SCHEMA = {
	type: "object",
	properties: {
		text: { type: "string", minLength: 1 },
		reply_to: { type: "integer", minimum: 1 },
		files: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 },
	},
	additionalProperties: false,
};

const EDIT_SCHEMA = {
	type: "object",
	properties: {
		message_id: { type: "integer", minimum: 1 },
		text: { type: "string", minLength: 1 },
	},
	required: ["message_id", "text"],
	additionalProperties: false,
};

const REACT_SCHEMA = {
	type: "object",
	properties: {
		message_id: { type: "integer", minimum: 1 },
		emoji: { type: "string", minLength: 1 },
	},
	required: ["message_id", "emoji"],
	additionalProperties: false,
};

const DOWNLOAD_SCHEMA = {
	type: "object",
	properties: {
		file_id: { type: "string", minLength: 1 },
	},
	required: ["file_id"],
	additionalProperties: false,
};

interface SendParams {
	text?: string;
	reply_to?: number;
	files?: string[];
}

export function registerChatTools(pi: ExtensionAPI, paths: TelegramPaths, bridge: TelegramBridge, formatCompletions: () => string): void {
	pi.registerTool({
		name: "telegram_status",
		label: "Telegram Status",
		description:
			"Report Telegram bridge connection state, bot identity, whether an owner is paired, pending pairing count, and the sanitized last error. " +
			"Never includes tokens, pending codes, owner/chat IDs, or state paths.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		approval: "read",
		execute: async () => toolText(formatToolStatus(bridge)),
	});

	pi.registerTool({
		name: "telegram_completions",
		label: "Telegram Completions",
		description:
			"List the /telegram operator subcommands with usage and confirmation requirements, for discovering valid /telegram arguments. " +
			"Never includes pairing codes, tokens, or IDs; live pairing codes are operator-only and appear only in the local /telegram status output.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		approval: "read",
		execute: async () => toolText(formatCompletions()),
	});

	pi.registerTool({
		name: "telegram_send",
		label: "Telegram Send",
		description:
			"Send an explicit extra message or requested files to the paired Telegram owner. " +
			"Do NOT use this for the ordinary final text answer during a Telegram turn; the final assistant reply is delivered automatically. " +
			"Use it when the owner requests a generated/local file, or for a proactive extra message the owner explicitly asked for.",
		parameters: SEND_SCHEMA,
		approval: "write",
		defaultInactive: true,
		execute: async (_toolCallId, params: SendParams) => {
			try {
				const hasText = typeof params.text === "string" && params.text.trim().length > 0;
				const files = params.files ?? [];
				if (!hasText && files.length === 0) return toolText("Provide nonempty text or at least one file.", true);
				const sentIds: number[] = [];
				const fail = (message: string) =>
					toolText(
						`Partially sent: ${sentIds.length} message(s) delivered. Remaining content was NOT sent. Failure: ${message}`,
						true,
					);
				if (hasText) {
					try {
						const id = await bridge.sendToOwner(params.text as string, params.reply_to);
						if (id !== undefined) sentIds.push(id);
					} catch (error) {
						return fail(bridge.sanitizeError(error));
					}
				}
				for (const filePath of files) {
					try {
						const resolved = resolveOutboundFile(paths.stateDir, filePath, paths.inboxDir);
						const id = await bridge.sendFileToOwner(resolved.kind, resolved.path, params.reply_to);
						if (id !== undefined) sentIds.push(id);
					} catch (error) {
						return fail(bridge.sanitizeError(error));
					}
				}
				return toolText(`Sent ${sentIds.length} message(s) to the paired owner: ${sentIds.join(", ")}`);
			} catch (error) {
				return toolError(bridge.sanitizeError(error));
			}
		},
	});

	pi.registerTool({
		name: "telegram_edit_message",
		label: "Telegram Edit Message",
		description: "Edit the text of a previously sent Telegram message to the paired owner.",
		parameters: EDIT_SCHEMA,
		approval: "write",
		defaultInactive: true,
		execute: async (_toolCallId, params: { message_id: number; text: string }) => {
			try {
				const id = await bridge.editOwnerMessage(params.message_id, params.text);
				return toolText(`Edited message ${id ?? params.message_id}.`);
			} catch (error) {
				return toolError(bridge.sanitizeError(error));
			}
		},
	});

	pi.registerTool({
		name: "telegram_react",
		label: "Telegram React",
		description: "Add an emoji reaction to a Telegram message from the paired owner. Only official Telegram reaction emoji are accepted.",
		parameters: REACT_SCHEMA,
		approval: "write",
		defaultInactive: true,
		execute: async (_toolCallId, params: { message_id: number; emoji: string }) => {
			try {
				await bridge.reactToOwner(params.message_id, params.emoji);
				return toolText(`Reacted to message ${params.message_id} with ${normalizeReactionEmoji(params.emoji)}.`);
			} catch (error) {
				return toolError(bridge.sanitizeError(error));
			}
		},
	});

	pi.registerTool({
		name: "telegram_download_attachment",
		label: "Telegram Download Attachment",
		description:
			"Download a document attachment the paired owner sent, into the private inbox. " +
			"Use before reading a file referenced by attachment_file_id in Telegram channel metadata. " +
			"Rejects file IDs that were not supplied by an admitted owner message.",
		parameters: DOWNLOAD_SCHEMA,
		approval: "write",
		defaultInactive: true,
		execute: async (_toolCallId, params: { file_id: string }) => {
			try {
				const path = await bridge.downloadAttachment(params.file_id);
				return toolText(`Downloaded to ${path}`);
			} catch (error) {
				return toolError(bridge.sanitizeError(error));
			}
		},
	});
}

function formatToolStatus(bridge: TelegramBridge): string {
	const status = bridge.getStatus();
	return [
		`connected=${status.connected}`,
		status.botUsername ? `bot=@${status.botUsername}` : undefined,
		status.botId !== undefined ? `bot_id=${status.botId}` : undefined,
		`ownerPaired=${status.ownerPaired}`,
		`pending=${status.pendingCount}`,
		status.lastError ? `lastError=${status.lastError}` : undefined,
	]
		.filter((part) => part !== undefined)
		.join(" ");
}
