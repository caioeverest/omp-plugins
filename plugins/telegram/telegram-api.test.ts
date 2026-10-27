import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createTelegramApi,
	isValidReactionEmoji,
	normalizeReactionEmoji,
	redactSecrets,
	resolveOutboundFile,
	sanitizeFilename,
	splitMessage,
	streamInboundFile,
	TelegramApiError,
	MESSAGE_LIMIT,
	DOWNLOAD_LIMIT,
	OUTBOUND_FILE_LIMIT,
	type FetchLike,
} from "./telegram-api.ts";

const TOKEN = "123456:TEST_TOKEN_NOT_REAL_1234567890";

describe("token redaction", () => {
	test("redactSecrets removes the raw and percent-encoded token", () => {
		expect(redactSecrets(`https://api.telegram.org/bot${TOKEN}/getMe`, TOKEN)).toBe("https://api.telegram.org/bot[redacted]/getMe");
		expect(redactSecrets(`x=${encodeURIComponent(TOKEN)}&y=${TOKEN}`, TOKEN)).toBe("x=[redacted]&y=[redacted]");
		expect(redactSecrets("nothing to hide", TOKEN)).toBe("nothing to hide");
		expect(redactSecrets(`has ${TOKEN}`, undefined)).toBe(`has ${TOKEN}`);
	});

	test("transport failures never surface the token from the request URL", async () => {
		const { fetch } = fakeFetch(() => {
			throw new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`);
		});
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		const error = (await api.sendMessage("1", "x").catch((e: unknown) => e)) as TelegramApiError;
		expect(error).toBeInstanceOf(TelegramApiError);
		expect(error.message).not.toContain(TOKEN);
		expect(error.message).toContain("[redacted]");
	});

	test("HTTP failures redact a token echoed in the description", async () => {
		const { fetch } = fakeFetch(() => errorBody(403, `forbidden for bot${TOKEN}`));
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		const error = (await api.sendMessage("1", "x").catch((e: unknown) => e)) as TelegramApiError;
		expect(error.message).not.toContain(TOKEN);
		expect(error.message).toContain("(HTTP 403)");
	});

	test("download failures redact the token-bearing file URL", async () => {
		const { fetch } = fakeFetch(() => {
			throw new Error(`request to https://api.telegram.org/file/bot${TOKEN}/voice/x.oga failed`);
		});
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		const error = (await api.downloadFile({ file_id: "f", file_path: "voice/x.oga" }).catch((e: unknown) => e)) as TelegramApiError;
		expect(error.message).not.toContain(TOKEN);
	});
});

interface RecordedRequest {
	url: string;
	init?: RequestInit;
}

function okBody(result: unknown): Response {
	return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function errorBody(status: number, description: string, retryAfter?: number): Response {
	return new Response(
		JSON.stringify({ ok: false, error_code: status, description, ...(retryAfter !== undefined ? { parameters: { retry_after: retryAfter } } : {}) }),
		{ status },
	);
}

function fakeFetch(responder: (url: string, init?: RequestInit) => Response | Promise<Response>): { fetch: FetchLike; requests: RecordedRequest[] } {
	const requests: RecordedRequest[] = [];
	const fetch: FetchLike = async (url, init) => {
		requests.push({ url, init });
		return responder(url, init);
	};
	return { fetch, requests };
}

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "omp-tg-api-"));
}

describe("request bodies and token-safe errors", () => {
	test("sendMessage sends JSON with chat_id and text", async () => {
		const { fetch, requests } = fakeFetch(() => okBody({ message_id: 5, chat: { id: 1, type: "private" } }));
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		await api.sendMessage("42", "hello");
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toContain("/bot123456:");
		expect(requests[0].url).toContain("/sendMessage");
		const body = JSON.parse(String(requests[0].init?.body));
		expect(body).toEqual({ chat_id: "42", text: "hello" });
	});

	test("reply_parameters only ride the first chunk", async () => {
		const { fetch, requests } = fakeFetch(() => okBody({ message_id: 5, chat: { id: 1, type: "private" } }));
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		await api.sendMessage("42", "x".repeat(MESSAGE_LIMIT * 2 + 10), { replyTo: 77 });
		expect(requests).toHaveLength(3);
		expect(JSON.parse(String(requests[0].init?.body)).reply_parameters).toEqual({ message_id: 77 });
		expect(JSON.parse(String(requests[1].init?.body)).reply_parameters).toBeUndefined();
	});

	test("failures report method/status/description and never the token", async () => {
		const leaky = `telegram bot${TOKEN}/sendMessage failed`;
		const { fetch } = fakeFetch(() => errorBody(400, leaky));
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		const error = await api.sendMessage("1", "x").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TelegramApiError);
		const message = (error as TelegramApiError).message;
		expect(message).toContain("sendMessage failed (HTTP 400)");
		expect(message).not.toContain(TOKEN);
	});

	test("getUpdates requests long polling with allowed_updates message", async () => {
		const { fetch, requests } = fakeFetch(() => okBody([]));
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch });
		await api.getUpdates(10);
		const body = JSON.parse(String(requests[0].init?.body));
		expect(body).toEqual({ timeout: 25, allowed_updates: ["message"], offset: 10 });
	});

	test("polling retries network failures with capped backoff, then succeeds", async () => {
		let calls = 0;
		const delays: number[] = [];
		const { fetch } = fakeFetch(() => {
			calls += 1;
			if (calls < 3) throw new Error("socket down");
			return okBody([]);
		});
		const api = createTelegramApi(TOKEN, {
			fetchImpl: fetch,
			backoffMs: (attempt) => {
				delays.push(attempt);
				return 1;
			},
			delay: async () => {},
		});
		const updates = await api.getUpdates(1);
		expect(updates).toEqual([]);
		expect(calls).toBe(3);
	});

	test("polling honors Telegram retry_after clamped to 1-60 seconds", async () => {
		let calls = 0;
		let waited = 0;
		const { fetch } = fakeFetch(() => {
			calls += 1;
			if (calls === 1) return errorBody(429, "Too Many Requests", 120);
			return okBody([]);
		});
		const api = createTelegramApi(TOKEN, {
			fetchImpl: fetch,
			delay: async (ms) => {
				waited = ms;
			},
		});
		await api.getUpdates(1);
		expect(waited).toBe(60000);
		expect(calls).toBe(2);
	});

	test("send operations are never retried, including 429", async () => {
		let calls = 0;
		const { fetch } = fakeFetch(() => {
			calls += 1;
			return errorBody(429, "Too Many Requests", 1);
		});
		const api = createTelegramApi(TOKEN, { fetchImpl: fetch, delay: async () => {} });
		await expect(api.sendMessage("1", "x")).rejects.toThrow(/HTTP 429/);
		expect(calls).toBe(1);
	});
});

describe("message chunking", () => {
	test("short text passes through untouched", () => {
		expect(splitMessage("hello")).toEqual(["hello"]);
	});

	test("splits at paragraph boundaries when possible", () => {
		const first = "a".repeat(3000);
		const second = "b".repeat(3000);
		const chunks = splitMessage(`${first}\n\n${second}`);
		expect(chunks).toEqual([first, second]);
	});

	test("falls back to newline, space, then hard cut", () => {
		const hard = "x".repeat(MESSAGE_LIMIT + 500);
		const chunks = splitMessage(hard);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]).toHaveLength(MESSAGE_LIMIT);
		const words = splitMessage(`${"y ".repeat(5000)}`);
		for (const chunk of words) expect(chunk.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
	});
});

describe("reaction emoji validation", () => {
	test("normalizes variation selectors before validation", () => {
		expect(normalizeReactionEmoji("👍\uFE0F")).toBe("👍");
		expect(normalizeReactionEmoji("✍\uFE0F")).toBe("✍");
		expect(isValidReactionEmoji("👍\uFE0F")).toBe(true);
	});

	test("rejects emoji outside the official set", () => {
		expect(isValidReactionEmoji("🙂")).toBe(false);
		expect(isValidReactionEmoji("a")).toBe(false);
		expect(isValidReactionEmoji("❤‍🔥")).toBe(true);
		expect(isValidReactionEmoji("👨‍💻")).toBe(true);
	});
});

describe("outbound file policy", () => {
	test("classifies photo extensions and rejects state-dir files outside inbox", () => {
		const dir = tempDir();
		try {
			const stateDir = join(dir, "telegram");
			const inbox = join(stateDir, "inbox");
			mkdirSync(inbox, { recursive: true });
			const photo = join(dir, "pic.jpg");
			writeFileSync(photo, "x");
			const resolved = resolveOutboundFile(stateDir, photo, inbox);
			expect(resolved.kind).toBe("photo");
			expect(resolved.path).toBe(realpathSync(photo));

			const secret = join(stateDir, "access.json");
			writeFileSync(secret, "{}");
			expect(() => resolveOutboundFile(stateDir, secret, inbox)).toThrow(/state directory/);

			const inboxFile = join(inbox, "note.txt");
			writeFileSync(inboxFile, "x");
			const inboxResolved = resolveOutboundFile(stateDir, inboxFile, inbox);
			expect(inboxResolved.kind).toBe("document");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("symlinks are resolved before policy checks", () => {
		const dir = tempDir();
		try {
			const stateDir = join(dir, "telegram");
			mkdirSync(stateDir, { recursive: true });
			const outside = join(dir, "real.txt");
			writeFileSync(outside, "ok");
			const link = join(stateDir, "link.txt");
			symlinkSync(outside, link);
			const resolved = resolveOutboundFile(stateDir, link, join(stateDir, "inbox"));
			expect(resolved.path).toBe(realpathSync(outside));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rejects oversized files and missing files", () => {
		const dir = tempDir();
		try {
			const big = join(dir, "big.bin");
			writeFileSync(big, Buffer.alloc(1));
			statSync(big); // touch
			expect(() => resolveOutboundFile(join(dir, "none"), join(dir, "missing.bin"))).toThrow(/does not exist/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("inbound download streaming", () => {
	function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}, status = 200): Response {
		return new Response(new Blob(chunks), { status, headers });
	}

	test("streams chunks, publishes 0600, and reports byte count", async () => {
		const dir = tempDir();
		try {
			const { path, size } = await streamInboundFile(streamResponse([new TextEncoder().encode("hello "), new TextEncoder().encode("world")]), dir, "out.bin", DOWNLOAD_LIMIT);
			expect(size).toBe(11);
			expect(statSync(path).mode & 0o777).toBe(0o600);
			expect(await Bun.file(path).text()).toBe("hello world");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("enforces Content-Length and streamed limits, removing partials", async () => {
		const dir = tempDir();
		try {
			await expect(
				streamInboundFile(streamResponse([], { "content-length": String(DOWNLOAD_LIMIT + 1) }), dir, "big.bin", DOWNLOAD_LIMIT),
			).rejects.toThrow(/download limit/);
			await expect(
				streamInboundFile(streamResponse([new Uint8Array(DOWNLOAD_LIMIT + 1)]), dir, "big2.bin", DOWNLOAD_LIMIT),
			).rejects.toThrow(/while streaming/);
			const entries = Array.from(new Bun.Glob("*").scanSync({ cwd: dir }));
			expect(entries).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("rejects error status responses", async () => {
		const dir = tempDir();
		await expect(streamInboundFile(new Response("nope", { status: 404 }), dir, "x.bin", DOWNLOAD_LIMIT)).rejects.toThrow(/downloadFile/);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("sanitizeFilename", () => {
	test("strips path separators and control characters", () => {
		expect(sanitizeFilename("../../etc/passwd", "stem")).toBe("etcpasswd.bin");
		expect(sanitizeFilename("evil\u0000\u001fname.txt", "stem")).toBe("evilname.txt");
		expect(sanitizeFilename(undefined, "photo-1")).toBe("photo-1.bin");
	});

	test("keeps a readable stem and safe extension", () => {
		expect(sanitizeFilename("Report 2026.pdf", "f")).toBe("Report 2026.pdf");
	});
});

describe("file send uses FormData with the right field", () => {
	test("sendPhoto appends a photo field and sendDocument a document field", async () => {
		const dir = tempDir();
		try {
			const photo = join(dir, "pic.jpg");
			const doc = join(dir, "doc.pdf");
			writeFileSync(photo, "jpgdata");
			writeFileSync(doc, "pdfdata");
			const seen: Array<{ url: string; field: string | null }> = [];
			const { fetch } = fakeFetch(() => okBody({ message_id: 9, chat: { id: 1, type: "private" } }));
			const api = createTelegramApi(TOKEN, {
				fetchImpl: (url, init) => {
					const form = init?.body as FormData;
					seen.push({ url, field: [...form.keys()].includes("photo") ? "photo" : "document" });
					return okBody({ message_id: 9, chat: { id: 1, type: "private" } });
				},
			});
			await api.sendPhoto("1", photo, { replyTo: 3 });
			await api.sendDocument("1", doc);
			expect(seen).toHaveLength(2);
			expect(seen[0].field).toBe("photo");
			expect(seen[1].field).toBe("document");
			expect(seen[0].url).toContain("/sendPhoto");
			expect(seen[1].url).toContain("/sendDocument");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("outbound size limit constant", () => {
	test("50 MiB outbound and 20 MiB download limits", () => {
		expect(OUTBOUND_FILE_LIMIT).toBe(50 * 1024 * 1024);
		expect(DOWNLOAD_LIMIT).toBe(20 * 1024 * 1024);
	});
});
