/**
 * Telegram Bot API transport. Dependency-free: only `fetch`, `FormData`,
 * `Blob`, and `Bun.file` are used. All failures are reported through
 * `TelegramApiError` carrying method/status/description and never the token or
 * a token-bearing URL.
 *
 * Send/edit/react/file operations are never retried automatically — even on
 * 429 — because replay can duplicate an external side effect. Only long
 * polling retries (network, 5xx, and 429 honoring `retry_after`).
 */

import { chmodSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const TELEGRAM_API_BASE = "https://api.telegram.org";
/** Telegram's hard outbound text cap. */
export const MESSAGE_LIMIT = 4096;
/** Telegram's bot-download limit. */
export const DOWNLOAD_LIMIT = 20 * 1024 * 1024;
/** Outbound file limit enforced by this plugin. */
export const OUTBOUND_FILE_LIMIT = 50 * 1024 * 1024;

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/** Official reaction emoji set (variation selectors already removed). */
export const REACTION_EMOJI: ReadonlySet<string> = new Set([
	"👍","👎","❤","🔥","🥰","👏","😁","🤔","🤯","😱","🤬","😢","🎉","🤩","🤮","💩","🙏","👌","🕊","🤡",
	"🥱","🥴","😍","🐳","❤‍🔥","🌚","🌭","💯","🤣","⚡","🍌","🏆","💔","🤨","😐","🍓","🍾","💋","🖕","😈",
	"😴","😭","🤓","👻","👨‍💻","👀","🎃","🙈","😇","😨","🤝","✍","🤗","🫡","🎅","🎄","☃","💅","🤪","🗿",
	"🆒","💘","🙉","🦄","😘","💊","🙊","😎","👾","🤷‍♂","🤷","🤷‍♀","😡",
]);

/**
 * Remove the bot token from any string bound for logs, stored state, or model
 * output. Redacts the raw token and its percent-encoded form, since the token
 * travels inside request URLs.
 */
export function redactSecrets(text: string, token: string | undefined): string {
	if (!token) return text;
	const encoded = encodeURIComponent(token);
	return text.split(token).join("[redacted]").split(encoded).join("[redacted]");
}

export class TelegramApiError extends Error {
	readonly method: string;
	readonly status?: number;
	readonly description?: string;
	readonly retryAfter?: number;

	constructor(method: string, status: number | undefined, description: string | undefined, retryAfter?: number) {
		super(`telegram ${method} failed${status !== undefined ? ` (HTTP ${status})` : ""}${description ? `: ${description}` : ""}`);
		this.name = "TelegramApiError";
		this.method = method;
		this.status = status;
		this.description = description;
		this.retryAfter = retryAfter;
	}
}

export interface BotInfo {
	id: number;
	username?: string;
	first_name?: string;
}

export interface TelegramUser {
	id: number;
	is_bot?: boolean;
	username?: string;
	first_name?: string;
}

export interface TelegramChat {
	id: number;
	type: string;
	title?: string;
	username?: string;
	first_name?: string;
}

export interface PhotoSize {
	file_id: string;
	file_unique_id?: string;
	width?: number;
	height?: number;
	file_size?: number;
}

export interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date?: number;
	text?: string;
	caption?: string;
	photo?: PhotoSize[];
	document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
	[key: string]: unknown;
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	[key: string]: unknown;
}

export interface TgFile {
	file_id: string;
	file_path?: string;
	file_size?: number;
}

export interface SendMessageOptions {
	replyTo?: number;
}

export interface GetUpdatesOptions {
	signal?: AbortSignal;
	timeout?: number;
	offset?: number;
	limit?: number;
}

export interface TelegramApi {
	getMe(): Promise<BotInfo>;
	deleteWebhook(options?: { drop_pending_updates?: boolean }): Promise<void>;
	getUpdates(offset: number | undefined, options?: GetUpdatesOptions): Promise<TelegramUpdate[]>;
	sendMessage(chatId: string, text: string, options?: SendMessageOptions): Promise<TelegramMessage>;
	sendPhoto(chatId: string, filePath: string, options?: SendMessageOptions): Promise<TelegramMessage>;
	sendDocument(chatId: string, filePath: string, options?: SendMessageOptions): Promise<TelegramMessage>;
	editMessageText(chatId: string, messageId: number, text: string): Promise<TelegramMessage>;
	setMessageReaction(chatId: string, messageId: number, emoji: string): Promise<void>;
	sendChatAction(chatId: string, action: string): Promise<void>;
	getFile(fileId: string): Promise<TgFile>;
	/** Raw file response; caller streams the body. URL is never exposed on error. */
	downloadFile(file: TgFile): Promise<Response>;
}

function sanitizeDescription(description: unknown): string | undefined {
	if (typeof description !== "string") return undefined;
	// Defensive: never leak a token if a server echoes the request URL back.
	return description.replaceAll(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>").slice(0, 500);
}

export function normalizeReactionEmoji(emoji: string): string {
	return emoji.replaceAll("\uFE0F", "").trim();
}

export function isValidReactionEmoji(emoji: string): boolean {
	return REACTION_EMOJI.has(normalizeReactionEmoji(emoji));
}

/** Split outbound text at the 4096 cap, preferring paragraph/newline/space boundaries. */
export function splitMessage(text: string, limit: number = MESSAGE_LIMIT): string[] {
	if (text.length <= limit) return [text];
	const chunks: string[] = [];
	let rest = text;
	while (rest.length > limit) {
		const head = rest.slice(0, limit);
		let cut = head.lastIndexOf("\n\n");
		if (cut < limit * 0.2) cut = head.lastIndexOf("\n");
		if (cut < limit * 0.2) cut = head.lastIndexOf(" ");
		if (cut <= 0) cut = limit;
		chunks.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^[ \n]+/, "");
	}
	if (rest.length > 0) chunks.push(rest);
	return chunks;
}

export interface OutboundFile {
	path: string;
	kind: "photo" | "document";
	size: number;
}

/**
 * Resolve an outbound file against the outbound policy: it must exist as a
 * regular file, its symlinks are resolved before policy checks, it must not
 * live inside the Telegram state directory (except `inbox/`), and it must be
 * at most 50 MiB.
 */
export function resolveOutboundFile(stateDir: string, filePath: string, inboxDir?: string): OutboundFile {
	let resolved: string;
	try {
		resolved = realpathSync(filePath);
	} catch {
		throw new Error(`File does not exist: ${filePath}`);
	}
	const stat = statSync(resolved);
	if (!stat.isFile()) throw new Error(`Not a regular file: ${filePath}`);
	let stateFence: string;
	try {
		stateFence = realpathSync(stateDir);
	} catch {
		stateFence = stateDir;
	}
	let inboxFence: string | undefined;
	if (inboxDir !== undefined) {
		try {
			inboxFence = realpathSync(inboxDir);
		} catch {
			inboxFence = inboxDir;
		}
	}
	const normalizedState = stateFence.endsWith("/") ? stateFence : `${stateFence}/`;
	if (resolved.startsWith(normalizedState)) {
		const allowed = inboxFence !== undefined && resolved.startsWith(inboxFence.endsWith("/") ? inboxFence : `${inboxFence}/`);
		if (!allowed) throw new Error(`Refusing to send a file from the private Telegram state directory: ${filePath}`);
	}
	if (stat.size > OUTBOUND_FILE_LIMIT) {
		throw new Error(`File exceeds the 50 MiB outbound limit: ${filePath} (${stat.size} bytes)`);
	}
	const ext = extname(resolved).toLowerCase();
	return { path: resolved, kind: PHOTO_EXTENSIONS.has(ext) ? "photo" : "document", size: stat.size };
}


export interface CreateTelegramApiOptions {
	fetchImpl?: FetchLike;
	/** Long-poll retry backoff base override (tests). */
	backoffMs?: (attempt: number) => number;
	/** Abortable delay override (tests). */
	delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function createTelegramApi(token: string, options: CreateTelegramApiOptions = {}): TelegramApi {
	const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
	const delay = options.delay ?? defaultAbortableDelay;
	const backoffMs = options.backoffMs ?? ((attempt: number) => Math.min(15000, 1000 * 2 ** (attempt - 1)));

	// Single choke point: every token-bearing error is redacted here, so
	// downstream callers cannot surface the token by handling errors loosely.
	const fail = (method: string, status: number | undefined, description: string | undefined, retryAfter?: number) =>
		new TelegramApiError(method, status, description === undefined ? undefined : redactSecrets(description, token), retryAfter);

	async function call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
		let response: Response;
		try {
			response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw fail(method, undefined, error instanceof Error ? error.message : String(error));
		}
		return parseResponse<T>(method, response);
	}

	async function parseResponse<T>(method: string, response: Response): Promise<T> {
		let payload: { ok?: boolean; result?: T; description?: unknown; parameters?: { retry_after?: unknown } } = {};
		try {
			payload = (await response.json()) as typeof payload;
		} catch {
			// non-JSON body: fall through with empty payload
		}
		if (!response.ok || payload.ok !== true) {
			const retryAfterRaw = payload.parameters?.retry_after;
			const retryAfter = typeof retryAfterRaw === "number" && Number.isFinite(retryAfterRaw) ? retryAfterRaw : undefined;
			throw fail(method, response.status, sanitizeDescription(payload.description) ?? (payload.ok === undefined ? `non-JSON response` : undefined), retryAfter);
		}
		return payload.result as T;
	}

	async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
		await delay(ms, signal);
	}

	const api: TelegramApi = {
		async getMe() {
			return call<BotInfo>("getMe", {});
		},

		async deleteWebhook(opts) {
			await call<boolean>("deleteWebhook", { drop_pending_updates: opts?.drop_pending_updates ?? false });
		},

		async getUpdates(offset, opts = {}) {
			const timeout = opts.timeout ?? 25;
			const body: Record<string, unknown> = { timeout, allowed_updates: ["message"] };
			if (offset !== undefined) body.offset = offset;
			if (opts.limit !== undefined) body.limit = opts.limit;
			let attempt = 0;
			for (;;) {
				attempt += 1;
				try {
					return await call<TelegramUpdate[]>("getUpdates", body, opts.signal);
				} catch (error) {
					if (opts.signal?.aborted || !(error instanceof TelegramApiError)) throw error;
					if (error.status !== undefined && error.status < 500 && error.status !== 429) throw error;
					let waitMs: number;
					if (error.status === 429) {
						waitMs = Math.min(60, Math.max(1, error.retryAfter ?? 1)) * 1000;
					} else {
						waitMs = backoffMs(attempt);
					}
					await abortableSleep(waitMs, opts.signal);
				}
			}
		},

		async sendMessage(chatId, text, opts = {}) {
			const parts = splitMessage(text);
			let last: TelegramMessage | undefined;
			for (let i = 0; i < parts.length; i += 1) {
				const body: Record<string, unknown> = { chat_id: chatId, text: parts[i] };
				if (i === 0 && opts.replyTo !== undefined) body.reply_parameters = { message_id: opts.replyTo };
				last = await call<TelegramMessage>("sendMessage", body);
			}
			return last as TelegramMessage;
		},

		async sendPhoto(chatId, filePath, opts = {}) {
			return sendFileLike(chatId, filePath, "photo", "sendPhoto", opts);
		},

		async sendDocument(chatId, filePath, opts = {}) {
			return sendFileLike(chatId, filePath, "document", "sendDocument", opts);
		},

		async editMessageText(chatId, messageId, text) {
			return call<TelegramMessage>("editMessageText", { chat_id: chatId, message_id: messageId, text });
		},

		async setMessageReaction(chatId, messageId, emoji) {
			const normalized = normalizeReactionEmoji(emoji);
			if (!REACTION_EMOJI.has(normalized)) {
				throw new TelegramApiError("setMessageReaction", undefined, `Unsupported reaction emoji: ${emoji}`);
			}
			await call<boolean>("setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji: normalized }] });
		},

		async sendChatAction(chatId, action) {
			await call<boolean>("sendChatAction", { chat_id: chatId, action });
		},

		async getFile(fileId) {
			return call<TgFile>("getFile", { file_id: fileId });
		},

		async downloadFile(file) {
			if (!file.file_path) throw new TelegramApiError("downloadFile", undefined, "Telegram returned no file_path for this file");
			let response: Response;
			try {
				response = await fetchImpl(`${TELEGRAM_API_BASE}/file/bot${token}/${file.file_path}`);
			} catch (error) {
				throw fail("downloadFile", undefined, error instanceof Error ? error.message : String(error));
			}
			if (!response.ok) {
				throw fail("downloadFile", response.status, sanitizeDescription(await safeText(response)));
			}
			return response;
		},
	};

	async function sendFileLike(chatId: string, filePath: string, field: "photo" | "document", method: string, opts: SendMessageOptions): Promise<TelegramMessage> {
		const file = Bun.file(filePath);
		const form = new FormData();
		form.append("chat_id", chatId);
		if (opts.replyTo !== undefined) form.append("reply_parameters", JSON.stringify({ message_id: opts.replyTo }));
		form.append(field, file, basename(filePath));
		let response: Response;
		try {
			response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${token}/${method}`, { method: "POST", body: form });
		} catch (error) {
			if (error instanceof TelegramApiError) throw error;
			throw fail(method, undefined, error instanceof Error ? error.message : String(error));
		}
		return parseResponse<TelegramMessage>(method, response);
	}

	return api;
}

async function safeText(response: Response): Promise<string | undefined> {
	try {
		return sanitizeDescription(await response.text());
	} catch {
		return undefined;
	}
}

function defaultAbortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timer = setTimeout(() => {
		signal?.removeEventListener("abort", onAbort);
		resolve();
	}, ms);
	const onAbort = () => {
		clearTimeout(timer);
		reject(new Error("Aborted"));
	};
	if (signal) {
		if (signal.aborted) return onAbort();
		signal.addEventListener("abort", onAbort, { once: true });
	}
	return promise;
}

export interface StreamedInboundFile {
	path: string;
	size: number;
}

/**
 * Stream a Telegram file response into a temp file while counting bytes, then
 * atomically publish it under `destDir` with mode 0600. Never materializes a
 * second whole-file buffer; removes the partial file on failure.
 */
export async function streamInboundFile(response: Response, destDir: string, fileName: string, maxBytes: number, fetchLike?: FetchLike): Promise<StreamedInboundFile> {
	void fetchLike;
	if (!response.ok) throw new TelegramApiError("downloadFile", response.status, undefined);
	const contentLength = response.headers.get("content-length");
	if (contentLength !== null) {
		const declared = Number(contentLength);
		if (Number.isFinite(declared) && declared > maxBytes) {
			throw new Error(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB download limit (Content-Length ${declared}).`);
		}
	}
	if (!response.body) throw new TelegramApiError("downloadFile", undefined, "empty response body");
	const finalPath = join(destDir, fileName);
	const tmpPath = join(destDir, `.${fileName}.part`);
	const sink = Bun.file(tmpPath).writer();
	let size = 0;
	try {
		const reader = response.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				throw new Error(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB download limit while streaming (${size} bytes).`);
			}
			sink.write(value);
		}
		await sink.end();
		chmodSync(tmpPath, 0o600);
		renameSync(tmpPath, finalPath);
	} catch (error) {
		try {
			sink.end();
		} catch {
			// already ended
		}
		try {
			rmSync(tmpPath, { force: true });
		} catch {
			// best effort
		}
		throw error;
	}
	return { path: finalPath, size };
}

/** Strip path separators and unsafe characters from a filename, keep a readable stem. */
export function sanitizeFilename(name: string | undefined, fallbackStem: string): string {
	const cleaned = (name ?? "")
		.replaceAll(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "")
		.replace(/^\.+/, "")
		.trim();
	if (cleaned.length === 0) return fallbackStem.includes(".") ? fallbackStem : `${fallbackStem}.bin`;
	const ext = extname(cleaned).toLowerCase().replace(/[^a-z0-9.]/g, "");
	const stem = basename(cleaned, extname(cleaned)).slice(0, 64) || fallbackStem;
	return `${stem}${ext || ".bin"}`;
}
