import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelegramBridge, TELEGRAM_TURN_SYSTEM_PROMPT, type TelegramBridge } from "./bridge.ts";
import { readCursor, readPollerLock, resolveTelegramPaths, setTokenInEnvFile, type TelegramPaths } from "./state.ts";
import { TelegramApiError, type TelegramApi, type TelegramUpdate } from "./telegram-api.ts";

const TOKEN = "123456:TEST_TOKEN_NOT_REAL_1234567890";

interface SentEntry {
	method: string;
	body: Record<string, unknown>;
}

class FakeApi implements TelegramApi {
	sent: SentEntry[] = [];
	private updatesQueue: TelegramUpdate[][] = [];
	private syncQueue: TelegramUpdate[][] = [];
	private waiter?: { resolve: (updates: TelegramUpdate[]) => void; reject: (error: unknown) => void };
	private failUpdates: TelegramApiError | undefined;

	getMe() {
		this.sent.push({ method: "getMe", body: {} });
		return Promise.resolve({ id: 42, username: "testbot", first_name: "Test" });
	}

	deleteWebhook(options?: { drop_pending_updates?: boolean }) {
		this.sent.push({ method: "deleteWebhook", body: options ?? {} });
		return Promise.resolve();
	}

	getUpdates(offset: number | undefined, options?: { signal?: AbortSignal; timeout?: number; limit?: number }) {
		this.sent.push({ method: "getUpdates", body: { offset, timeout: options?.timeout } });
		if (this.failUpdates) {
			const failure = this.failUpdates;
			this.failUpdates = undefined;
			return Promise.reject(failure);
		}
		if (offset === -1) return Promise.resolve(this.syncQueue.shift() ?? []);
		if (this.updatesQueue.length > 0) return Promise.resolve(this.updatesQueue.shift() as TelegramUpdate[]);
		const { promise, resolve, reject } = Promise.withResolvers<TelegramUpdate[]>();
		this.waiter = { resolve, reject };
		options?.signal?.addEventListener("abort", () => resolve([]), { once: true });
		return promise;
	}

	sendMessage(chatId: string, text: string, options?: { replyTo?: number }) {
		this.sent.push({ method: "sendMessage", body: { chat_id: chatId, text, replyTo: options?.replyTo } });
		return Promise.resolve({ message_id: 900 + this.sent.length, chat: { id: Number(chatId), type: "private" } });
	}

	sendPhoto(chatId: string, filePath: string, options?: { replyTo?: number }) {
		this.sent.push({ method: "sendPhoto", body: { chat_id: chatId, filePath, replyTo: options?.replyTo } });
		return Promise.resolve({ message_id: 900 + this.sent.length, chat: { id: Number(chatId), type: "private" } });
	}

	sendDocument(chatId: string, filePath: string, options?: { replyTo?: number }) {
		this.sent.push({ method: "sendDocument", body: { chat_id: chatId, filePath, replyTo: options?.replyTo } });
		return Promise.resolve({ message_id: 900 + this.sent.length, chat: { id: Number(chatId), type: "private" } });
	}

	editMessageText(chatId: string, messageId: number, text: string) {
		this.sent.push({ method: "editMessageText", body: { chat_id: chatId, messageId, text } });
		return Promise.resolve({ message_id: messageId, chat: { id: Number(chatId), type: "private" } });
	}

	setMessageReaction(chatId: string, messageId: number, emoji: string) {
		this.sent.push({ method: "setMessageReaction", body: { chat_id: chatId, messageId, emoji } });
		return Promise.resolve();
	}

	sendChatAction(chatId: string, action: string) {
		this.sent.push({ method: "sendChatAction", body: { chat_id: chatId, action } });
		return Promise.resolve();
	}

	getFile(fileId: string) {
		this.sent.push({ method: "getFile", body: { fileId } });
		return Promise.resolve({ file_id: fileId, file_path: `documents/${fileId}`, file_size: 5 });
	}

	downloadFile(file: { file_path?: string }) {
		this.sent.push({ method: "downloadFile", body: { file_path: file.file_path } });
		return Promise.resolve(new Response(new TextEncoder().encode("hello")));
	}

	push(update: TelegramUpdate): void {
		if (this.waiter) {
			const waiter = this.waiter;
			this.waiter = undefined;
			waiter.resolve([update]);
		} else {
			this.updatesQueue.push([update]);
		}
	}

	pushSync(update: TelegramUpdate): void {
		this.syncQueue.push([update]);
	}

	failNextUpdates(error: TelegramApiError): void {
		if (this.waiter) {
			const waiter = this.waiter;
			this.waiter = undefined;
			waiter.reject(error);
		} else {
			this.failUpdates = error;
		}
	}


	calls(method: string): SentEntry[] {
		return this.sent.filter((entry) => entry.method === method);
	}
}

interface Harness {
	dir: string;
	paths: TelegramPaths;
	api: FakeApi;
	sent: Array<{ content: string; deliverAs?: string }>;
	randomCodes: string[];
	bridge: TelegramBridge;
}

let codeCounter = 0;

function makeBridge(log?: (text: string) => void): Harness {
	const dir = mkdtempSync(join(tmpdir(), "omp-tg-bridge-"));
	const paths = resolveTelegramPaths(dir, {});
	mkdirSync(paths.stateDir, { recursive: true });
	setTokenInEnvFile(paths, TOKEN);
	const api = new FakeApi();
	const sent: Array<{ content: string; deliverAs?: string }> = [];
	const randomCodes: string[] = [];
	const bridge = createTelegramBridge({
		paths,
		env: {},
		log,
		sessionId: "test-session",
		sendUserMessage: (content, opts) => {
			sent.push({ content, deliverAs: opts?.deliverAs });
		},
		clock: () => 1_000_000,
		randomCode: () => {
			codeCounter += 1;
			const code = codeCounter.toString(16).padStart(6, "0");
			randomCodes.push(code);
			return code;
		},
		randomId: () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0"),
		nowIso: () => new Date(1_000_000).toISOString(),
		createApi: () => api,
	});
	return { dir, paths, api, sent, randomCodes, bridge };
}

function cleanup(harness: Harness): void {
	rmSync(harness.dir, { recursive: true, force: true });
}

function privateMessage(updateId: number, userId: number, text: string, extra: Record<string, unknown> = {}): TelegramUpdate {
	return {
		update_id: updateId,
		message: {
			message_id: updateId + 500,
			from: { id: userId, is_bot: false, username: `user${userId}`, first_name: `User${userId}` },
			chat: { id: userId, type: "private" },
			text,
			...extra,
		},
	};
}

/** Await a real condition with a bounded deadline; no fixed sleeps. */
async function settle(harness: Harness, predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > timeoutMs) throw new Error("settle timed out");
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
}

/** Connect, pair the first unknown sender, and return the pending sent prompt count baseline. */
async function pairOwner(harness: Harness): Promise<void> {
	await harness.bridge.connect();
	harness.api.push(privateMessage(1, 777, "hello bot"));
	await settle(harness, () => harness.api.calls("sendMessage").length >= 1);
	const code = harness.api.calls("sendMessage")[0].body.text.match(/pair ([0-9a-f]{6})/)?.[1] as string;
	await harness.bridge.pair(code);
	expect(JSON.parse(readFileSync(harness.paths.accessPath, "utf8")).owner.userId).toBe("777");
}

describe("connect lifecycle", () => {
	test("first-run cursor synchronization records the latest update without dispatching it", async () => {
		const harness = makeBridge();
		try {
			harness.api.pushSync(privateMessage(99, 1, "dropped"));
			await harness.bridge.connect();
			expect(harness.sent).toHaveLength(0);
			expect(readCursor(harness.paths)).toEqual({ botId: 42, lastUpdateId: 99 });
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("connect persists bot identity and acquires the poller lock; disconnect releases it", async () => {
		const harness = makeBridge();
		try {
			await harness.bridge.connect();
			expect(harness.bridge.isConnected()).toBe(true);
			expect(readPollerLock(harness.paths)?.ownerId).toContain("omp-");
			await harness.bridge.disconnect();
			expect(harness.bridge.isConnected()).toBe(false);
			expect(readPollerLock(harness.paths)).toBeUndefined();
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("cursor for another bot identity fails connect without resetting", async () => {
		const harness = makeBridge();
		try {
			writeFileSync(harness.paths.cursorPath, JSON.stringify({ botId: 999, lastUpdateId: 5 }));
			await expect(harness.bridge.connect()).rejects.toThrow(/belongs to bot 999/);
			expect(readCursor(harness.paths)).toEqual({ botId: 999, lastUpdateId: 5 });
		} finally {
			cleanup(harness);
		}
	});

	test("malformed cursor fails connect with its path", async () => {
		const harness = makeBridge();
		try {
			mkdirSync(harness.paths.stateDir, { recursive: true });
			writeFileSync(harness.paths.cursorPath, "not json");
			await expect(harness.bridge.connect()).rejects.toThrow(/cursor\.json/);
		} finally {
			cleanup(harness);
		}
	});

	test("terminal 409 error stops polling, records status, releases the lock", async () => {
		const harness = makeBridge();
		try {
			await harness.bridge.connect();
			harness.api.failNextUpdates(new TelegramApiError("getUpdates", 409, "Conflict: terminated by other getUpdates request"));
			await settle(harness, () => !harness.bridge.isConnected() && readPollerLock(harness.paths) === undefined);
			expect(harness.bridge.getStatus().lastError).toMatch(/409/);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});
});

describe("pairing-before-delivery", () => {
	test("unknown DM gets a pairing reply with the exact code and zero OMP prompts", async () => {
		const harness = makeBridge();
		try {
			await harness.bridge.connect();
			harness.api.push(privateMessage(1, 777, "hello bot"));
			await settle(harness, () => harness.api.calls("sendMessage").length >= 1);
			const reply = harness.api.calls("sendMessage")[0].body;
			expect(String(reply.text)).toMatch(/\/telegram pair [0-9a-f]{6}/);
			expect(harness.sent).toHaveLength(0);
			expect(readCursor(harness.paths)?.lastUpdateId).toBe(1);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("failed pairing reply does not advance the cursor, so replay retries the same code", async () => {
		const harness = makeBridge();
		try {
			await harness.bridge.connect();
			const original = harness.api.sendMessage.bind(harness.api);
			let failures = 0;
			harness.api.sendMessage = (chatId: string, text: string, options?: { replyTo?: number }) => {
				if (text.includes("/telegram pair") && failures === 0) {
					failures += 1;
					return Promise.reject(new TelegramApiError("sendMessage", 400, "chat not found"));
				}
				return original(chatId, text, options);
			};
			harness.api.push(privateMessage(1, 777, "hello bot"));
			await settle(harness, () => failures >= 1);
			expect(readCursor(harness.paths)).toBeUndefined();
			// Replay the same update: the code persisted before the send, so the retry reuses it.
			harness.api.push(privateMessage(1, 777, "hello bot"));
			await settle(harness, () => harness.api.calls("sendMessage").some((c) => String(c.body.text).includes("/telegram pair")));
			expect(readCursor(harness.paths)?.lastUpdateId).toBe(1);
			const access = JSON.parse(readFileSync(harness.paths.accessPath, "utf8"));
			const replies = Object.values(access.pending).map((p) => (p as { replies: number }).replies);
			expect(replies).toEqual([1]);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("pairing the exact code admits the owner; a second sender is dropped", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			harness.api.push(privateMessage(2, 777, "run the tests"));
			harness.api.push(privateMessage(3, 888, "injected"));
			await settle(harness, () => harness.sent.length >= 1);
			expect(harness.sent).toHaveLength(1);
			expect(harness.sent[0].content).toContain("run the tests");
			expect(readCursor(harness.paths)?.lastUpdateId).toBe(3);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});
});

describe("owner prompt delivery", () => {
	test("busy session queues owner messages FIFO as followUp with sanitized metadata", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			const seam = {
				isIdle: () => true,
				setInterval: () => ({ unref: () => {} }),
				clearTimer: () => {},
			};
			harness.api.push(privateMessage(2, 777, "first task"));
			await settle(harness, () => harness.sent.length >= 1);
			const result = harness.bridge.handleBeforeAgentStart(harness.sent[0].content, ["base"], seam);
			expect(result?.systemPrompt).toEqual(["base", TELEGRAM_TURN_SYSTEM_PROMPT]);

			// Busy seam for subsequent deliveries while the first turn is active.
			const busySeam = { ...seam, isIdle: () => false };
			harness.bridge.clearTyping();
			harness.bridge.handleBeforeAgentStart(harness.sent[0].content, ["base"], busySeam);
			harness.api.push({
				update_id: 3,
				message: {
					message_id: 503,
					from: { id: 777, is_bot: false, username: 'evil"><script>&\u0007', first_name: 'Bad"Name' },
					chat: { id: 777, type: "private" },
					text: "second task",
				},
			});
			harness.api.push(privateMessage(4, 777, "third task"));
			await settle(harness, () => harness.sent.length >= 3);
			expect(harness.sent[1].deliverAs).toBe("followUp");
			expect(harness.sent[2].deliverAs).toBe("followUp");
			const meta = harness.sent[1].content.split("\n")[1];
			expect(meta).toContain('source="telegram"');
			expect(meta).toContain('user_id="777"');
			expect(meta).toContain("&quot;&gt;&lt;script&gt;&amp;");
			expect(meta).not.toContain('"><script>');
			expect(harness.sent[1].content.endsWith("second task")).toBe(true);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("document updates admit file IDs lazily; download requires an admitted ID", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			harness.api.push(
				privateMessage(2, 777, "(document: notes.txt)", {
					document: { file_id: "doc-1", file_name: "notes.txt", mime_type: "text/plain", file_size: 5 },
				}),
			);
			await settle(harness, () => harness.sent.length >= 1);
			const meta = harness.sent[0].content.split("\n")[1];
			expect(meta).toContain('attachment_file_id="doc-1"');
			expect(meta).toContain('attachment_name="notes.txt"');
			expect(meta).toContain('attachment_size="5"');
			expect(meta).toContain('attachment_mime="text/plain"');
			await expect(harness.bridge.downloadAttachment("doc-2")).rejects.toThrow(/not supplied by an admitted owner message/);
			const path = await harness.bridge.downloadAttachment("doc-1");
			expect(readFileSync(path, "utf8")).toBe("hello");
			expect(path.startsWith(harness.paths.inboxDir)).toBe(true);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("photo updates download eagerly into the inbox, selecting the largest size", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			harness.api.push(
				privateMessage(2, 777, "", {
					caption: "look at this",
					photo: [
						{ file_id: "photo-small", file_size: 2, width: 100 },
						{ file_id: "photo-large", file_size: 5, width: 1280 },
					],
				}),
			);
			await settle(harness, () => harness.sent.length >= 1);
			const meta = harness.sent[0].content.split("\n")[1];
			expect(meta).toContain('image_path="');
			expect(harness.sent[0].content.endsWith("look at this")).toBe(true);
			expect(harness.api.calls("getFile")[0].body.fileId).toBe("photo-large");
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("unsupported message kinds get one concise reply and are never injected", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			harness.api.push(privateMessage(2, 777, undefined, { voice: { file_id: "v1", duration: 2 } }));
			await settle(harness, () => harness.api.calls("sendMessage").some((c) => String(c.body.text).includes("text, photos, and documents")));
			expect(harness.sent).toHaveLength(0);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("admitted attachment registry evicts the oldest entry beyond 100", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			for (let i = 1; i <= 101; i += 1) {
				harness.api.push(
					privateMessage(i + 10, 777, "(document)", {
						document: { file_id: `doc-${i}`, file_name: `f${i}.txt`, file_size: 5 },
					}),
				);
			}
			await settle(harness, () => harness.sent.length >= 101);
			await expect(harness.bridge.downloadAttachment("doc-1")).rejects.toThrow(/not supplied/);
			const path = await harness.bridge.downloadAttachment("doc-101");
			expect(readFileSync(path, "utf8")).toBe("hello");
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});
});

describe("final reply delivery", () => {
	test("willContinue true delivers nothing; the final event delivers exactly one reply to the inbound message", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			harness.api.push(privateMessage(2, 777, "question"));
			await settle(harness, () => harness.sent.length >= 1);
			const before = harness.api.calls("sendMessage").length;

			// willContinue=true: a continuation is scheduled; the bridge must not treat this as terminal.
			harness.bridge.handleBeforeAgentStart(harness.sent[0].content, [], undefined);
			await harness.bridge.handleAgentEnd([{ role: "assistant", content: [{ type: "text", text: "partial" }] }], { willContinue: true });
			expect(harness.api.calls("sendMessage")).toHaveLength(before);
			harness.bridge.clearTyping();

			// Re-arm the same turn and deliver the terminal event once.
			harness.bridge.handleBeforeAgentStart(harness.sent[0].content, [], undefined);
			await harness.bridge.handleAgentEnd([
				{ role: "user", content: [{ type: "text", text: "question" }] },
				{ role: "assistant", content: [{ type: "text", text: "final" }], stopReason: "end_turn" },
			]);
			const final = harness.api.calls("sendMessage").slice(before);
			expect(final).toHaveLength(1);
			expect(final[0].body.text).toBe("final");
			expect(final[0].body.replyTo).toBe(502);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("local turns never auto-push to Telegram", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			const before = harness.api.calls("sendMessage").length;
			expect(harness.bridge.handleBeforeAgentStart("just a local prompt", [], undefined)).toBeUndefined();
			await harness.bridge.handleAgentEnd([{ role: "assistant", content: [{ type: "text", text: "local answer" }] }]);
			expect(harness.api.calls("sendMessage")).toHaveLength(before);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("final assistant without text reports the stop reason without internal stack data", async () => {
		const harness = makeBridge();
		try {
			await pairOwner(harness);
			harness.api.push(privateMessage(2, 777, "question"));
			await settle(harness, () => harness.sent.length >= 1);
			harness.bridge.handleBeforeAgentStart(harness.sent[0].content, [], undefined);
			await harness.bridge.handleAgentEnd([
				{ role: "assistant", content: [{ type: "text", text: "" }], stopReason: "error", errorMessage: "provider exploded at /internal/stack" },
			]);
			const final = harness.api.calls("sendMessage").at(-1);
			expect(String(final?.body.text)).toContain("Turn ended without text");
			expect(String(final?.body.text)).toContain("provider exploded");
			expect(String(final?.body.text)).not.toContain("/internal/stack");
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});
});

describe("end-to-end fake transport", () => {
	test("inject, approve, deliver owner text and document while busy, observe one final reply plus authorized download", async () => {
		const harness = makeBridge();
		try {
			// 1. Unknown DM: pairing reply, zero OMP prompts.
			await harness.bridge.connect();
			harness.api.push(privateMessage(1, 777, "hi"));
			await settle(harness, () => harness.api.calls("sendMessage").length >= 1);
			expect(harness.sent).toHaveLength(0);
			const code = harness.api.calls("sendMessage")[0].body.text.match(/pair ([0-9a-f]{6})/)?.[1] as string;
			expect(code).toBe(harness.randomCodes[0]);

			// 2. Local approval of the exact code.
			await harness.bridge.pair(code);

			// 3. Owner text and document while OMP is busy: ordered followUp prompts.
			const busySeam = { isIdle: () => false, setInterval: () => ({ unref: () => {} }), clearTimer: () => {} };
			harness.api.push(privateMessage(2, 777, "summarize this"));
			harness.api.push(
				privateMessage(3, 777, "(document: data.csv)", {
					document: { file_id: "doc-9", file_name: "data.csv", mime_type: "text/csv", file_size: 5 },
				}),
			);
			await settle(harness, () => harness.sent.length >= 2);
			expect(harness.sent[0].content).toContain("summarize this");
			expect(harness.sent[1].content).toContain('attachment_file_id="doc-9"');

			harness.bridge.handleBeforeAgentStart(harness.sent[0].content, [], busySeam);
			// First settle with willContinue:true must deliver nothing and keep the turn armed.
			await harness.bridge.handleAgentEnd([{ role: "assistant", content: [{ type: "text", text: "working..." }] }], { willContinue: true });
			expect(harness.api.calls("sendMessage").some((c) => c.body.text === "working...")).toBe(false);
			await harness.bridge.handleAgentEnd([
				{ role: "assistant", content: [{ type: "text", text: "Here is the summary." }] },
			]);
			const finalReplies = harness.api.calls("sendMessage").filter((c) => c.body.text === "Here is the summary.");
			expect(finalReplies).toHaveLength(1);

			// 5. Authorized attachment download works; arbitrary file IDs are rejected.
			const path = await harness.bridge.downloadAttachment("doc-9");
			expect(readFileSync(path, "utf8")).toBe("hello");
			await expect(harness.bridge.downloadAttachment("doc-fake")).rejects.toThrow(/not supplied/);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});
});

describe("token redaction", () => {
	test("stored and logged errors from the transport never carry the token", async () => {
		const logs: string[] = [];
		const harness = makeBridge((text) => logs.push(text));
		try {
			await harness.bridge.connect();
			harness.api.failNextUpdates(new TelegramApiError("getUpdates", 409, `conflict for https://api.telegram.org/bot${TOKEN}/getUpdates`));
			await settle(harness, () => !harness.bridge.isConnected() && readPollerLock(harness.paths) === undefined);

			const lastError = harness.bridge.getStatus().lastError ?? "";
			expect(lastError).toMatch(/409/);
			expect(lastError).not.toContain(TOKEN);
			expect(logs.join("\n")).toMatch(/409/);
			expect(logs.join("\n")).not.toContain(TOKEN);
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});

	test("sanitize helpers redact the active token for callers", async () => {
		const harness = makeBridge();
		try {
			await harness.bridge.connect();
			expect(harness.bridge.sanitizeText(`https://api.telegram.org/bot${TOKEN}/getMe`)).toBe("https://api.telegram.org/bot[redacted]/getMe");
			expect(harness.bridge.sanitizeError(new Error(`failed for bot${TOKEN}`))).not.toContain(TOKEN);
			expect(harness.bridge.sanitizeText("no token here")).toBe("no token here");
		} finally {
			await harness.bridge.disconnect().catch(() => {});
			cleanup(harness);
		}
	});
});
