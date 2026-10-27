import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	acquirePollerLock,
	approvePairing,
	denyPairing,
	isOwnerMessage,
	isValidTokenFormat,
	clearTokenFromEnvFile,
	prunePending,
	readAccessState,
	readCursor,
	readTelegramToken,
	releasePollerLock,
	resolveTelegramPaths,
	setTokenInEnvFile,
	transitionPending,
	unpairOwner,
	withStateLock,
	writeAccessState,
	writeCursor,
	type TelegramAccessState,
	type TelegramPaths,
} from "./state.ts";

function tempStateDir(): TelegramPaths {
	const home = mkdtempSync(join(tmpdir(), "omp-tg-state-"));
	return resolveTelegramPaths(home);
}

function sender(userId = "100", chatId = userId) {
	return { userId, chatId, username: "sender", displayName: "Sender" };
}

const VALID_TOKEN = "123456:TEST_TOKEN_NOT_REAL_1234567890";

describe("resolveTelegramPaths", () => {
	test("defaults to <agent-dir>/telegram", () => {
		const paths = resolveTelegramPaths("/tmp/agent");
		expect(paths.stateDir).toBe("/tmp/agent/telegram");
		expect(paths.envPath).toBe("/tmp/agent/telegram/.env");
	});

	test("absolute OMP_TELEGRAM_STATE_DIR overrides the default", () => {
		const paths = resolveTelegramPaths("/tmp/agent", { OMP_TELEGRAM_STATE_DIR: "/tmp/other" });
		expect(paths.stateDir).toBe("/tmp/other");
	});
});

describe("token handling", () => {
	test("validates BotFather token format", () => {
		expect(isValidTokenFormat(VALID_TOKEN)).toBe(true);
		expect(isValidTokenFormat("123456:short")).toBe(false);
		expect(isValidTokenFormat("nosecret")).toBe(false);
	});

	test("environment token wins over the .env file", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.envPath, `TELEGRAM_BOT_TOKEN=1:filetokenfiletokenfiletoken\nOTHER=keep\n`);
		const resolved = readTelegramToken(paths, { TELEGRAM_BOT_TOKEN: VALID_TOKEN });
		expect(resolved).toEqual({ token: VALID_TOKEN, source: "environment" });
	});

	test("file token resolves from the exact TELEGRAM_BOT_TOKEN= line", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.envPath, "# comment\nOTHER=keep\nTELEGRAM_BOT_TOKEN=1:filetokenfiletokenfiletoken\n");
		const resolved = readTelegramToken(paths, {});
		expect(resolved?.source).toBe("file");
		expect(readTelegramToken(paths, {}).token).toBe("1:filetokenfiletokenfiletoken");
	});

	test("setToken preserves unrelated lines and collapses duplicates", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.envPath, "OTHER=keep\nTELEGRAM_BOT_TOKEN=1:oldtokenoldtokenoldtokenold\nTELEGRAM_BOT_TOKEN=1:oldertokenoldertokenold\n");
		setTokenInEnvFile(paths, VALID_TOKEN);
		const content = readFileSync(paths.envPath, "utf8");
		expect(content).toBe(`OTHER=keep\nTELEGRAM_BOT_TOKEN=${VALID_TOKEN}\n`);
	});

	test("setToken rejects malformed tokens without mutating the file", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.envPath, "OTHER=keep\n");
		expect(() => setTokenInEnvFile(paths, "bad")).toThrow();
		expect(readFileSync(paths.envPath, "utf8")).toBe("OTHER=keep\n");
	});

	test("clearToken removes only token lines", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		setTokenInEnvFile(paths, VALID_TOKEN);
		writeFileSync(paths.envPath, `OTHER=keep\nTELEGRAM_BOT_TOKEN=${VALID_TOKEN}\n`);
		expect(clearTokenFromEnvFile(paths)).toBe(true);
		expect(readFileSync(paths.envPath, "utf8")).toBe("OTHER=keep\n");
		expect(clearTokenFromEnvFile(paths)).toBe(false);
	});

	test("state files are published with mode 0600 and directory 0700", () => {
		const paths = tempStateDir();
		const previousUmask = process.umask(0o000);
		try {
			setTokenInEnvFile(paths, VALID_TOKEN);
			writeAccessState(paths, { pending: {} });
			const envMode = statSync(paths.envPath).mode & 0o777;
			const accessMode = statSync(paths.accessPath).mode & 0o777;
			const dirMode = statSync(paths.stateDir).mode & 0o777;
			expect(envMode).toBe(0o600);
			expect(accessMode).toBe(0o600);
			expect(dirMode & 0o700).toBe(0o700);
		} finally {
			process.umask(previousUmask);
		}
	});
});

describe("access state transitions", () => {
	test("missing state means no owner and no pending", () => {
		const paths = tempStateDir();
		const state = readAccessState(paths);
		expect(state.owner).toBeUndefined();
		expect(Object.keys(state.pending)).toHaveLength(0);
	});

	test("malformed access state fails closed with its path", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.accessPath, "{not json");
		expect(() => readAccessState(paths)).toThrow(/access\.json/);
	});

	test("malformed owner entry fails closed instead of reopening pairing", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.accessPath, JSON.stringify({ owner: { userId: "x" }, pending: {} }));
		expect(() => readAccessState(paths)).toThrow(/access\.json/);
	});

	test("unknown sender creates a six-hex code valid for one hour", () => {
		const now = 1_000_000;
		const t = transitionPending({ pending: {} }, sender(), now);
		expect(t.outcome).toBe("created");
		expect(t.code).toMatch(/^[0-9a-f]{6}$/);
		const entry = t.state.pending[t.code as string];
		expect(entry.expiresAt - entry.createdAt).toBe(60 * 60 * 1000);
	});

	test("reuses the live code for a reminder, then drops silently", () => {
		const now = 1_000_000;
		let state: TelegramAccessState = { pending: {} };
		const first = transitionPending(state, sender(), now);
		state = first.state;
		const second = transitionPending(state, sender(), now + 1);
		expect(second.outcome).toBe("remind");
		expect(second.code).toBe(first.code);
		// First instruction delivered: replies 0 -> 1.
		state = record(state, first.code as string);
		// Reminder delivered: replies 1 -> 2. Any further message is dropped.
		state = record(state, first.code as string);
		const third = transitionPending(state, sender(), now + 2);
		expect(third.outcome).toBe("silenced");
	});

	function record(state: TelegramAccessState, code: string): TelegramAccessState {
		const entry = state.pending[code];
		return { ...state, pending: { ...state.pending, [code]: { ...entry, replies: entry.replies + 1 } } };
	}

	test("caps live pending requests at three", () => {
		const now = 1_000_000;
		let state: TelegramAccessState = { pending: {} };
		for (let i = 0; i < 3; i += 1) {
			const t = transitionPending(state, sender(String(100 + i)), now);
			expect(t.outcome).toBe("created");
			state = t.state;
		}
		const fourth = transitionPending(state, sender("200"), now);
		expect(fourth.outcome).toBe("capped");
		expect(fourth.code).toBeUndefined();
	});

	test("expired entries are pruned before decisions, freeing the cap", () => {
		const now = 1_000_000;
		let state: TelegramAccessState = { pending: {} };
		for (let i = 0; i < 3; i += 1) {
			state = transitionPending(state, sender(String(100 + i)), now).state;
		}
		state = prunePending(state, now + 60 * 60 * 1000 + 1);
		const next = transitionPending(state, sender("200"), now + 60 * 60 * 1000 + 2);
		expect(next.outcome).toBe("created");
	});

	test("approvePairing requires the exact unexpired code and clears all pending", () => {
		const now = 1_000_000;
		const t = transitionPending({ pending: {} }, sender("777", "777"), now, () => "abc123");
		const approved = approvePairing(t.state, "abc123", now + 10);
		expect(approved.owner).toEqual({ userId: "777", chatId: "777", username: "sender", displayName: "Sender" });
		expect(Object.keys(approved.pending)).toHaveLength(0);
		expect(() => approvePairing(t.state, "ffffff", now + 10)).toThrow();
	});

	test("denyPairing removes only that live code", () => {
		const now = 1_000_000;
		const a = transitionPending({ pending: {} }, sender("1"), now, () => "aaaaaa");
		const b = transitionPending(a.state, sender("2"), now, () => "bbbbbb");
		const denied = denyPairing(b.state, "aaaaaa", now);
		expect(denied.pending["aaaaaa"]).toBeUndefined();
		expect(denied.pending["bbbbbb"]).toBeDefined();
	});

	test("unpair clears owner and pending", () => {
		const state: TelegramAccessState = { owner: { userId: "1", chatId: "1" }, pending: { aaaaaa: { userId: "2", chatId: "2", createdAt: 0, expiresAt: 1, replies: 0 } } };
		const cleared = unpairOwner(state);
		expect(cleared.owner).toBeUndefined();
		expect(Object.keys(cleared.pending)).toHaveLength(0);
	});

	test("single-owner gate admits only the exact userId in a private chat", () => {
		const state: TelegramAccessState = { owner: { userId: "42", chatId: "42" }, pending: {} };
		expect(isOwnerMessage(state, "42", "42", false)).toBe(true);
		expect(isOwnerMessage(state, "43", "42", false)).toBe(false);
		expect(isOwnerMessage(state, "42", "43", false)).toBe(false);
		expect(isOwnerMessage(state, "42", "42", true)).toBe(false);
		expect(isOwnerMessage({ pending: {} }, "42", "42", false)).toBe(false);
	});
});

describe("cursor", () => {
	test("missing cursor reads undefined; write then read round-trips", () => {
		const paths = tempStateDir();
		expect(readCursor(paths)).toBeUndefined();
		writeCursor(paths, { botId: 7, lastUpdateId: 99 });
		expect(readCursor(paths)).toEqual({ botId: 7, lastUpdateId: 99 });
	});

	test("malformed cursor fails closed with its path", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.cursorPath, "nope");
		expect(() => readCursor(paths)).toThrow(/cursor\.json/);
	});
});

describe("poller lock", () => {
	test("same runtime re-acquire is idempotent; foreign live pid fails without killing", () => {
		const paths = tempStateDir();
		const lock = acquirePollerLock(paths, "session-a", "owner-1");
		expect(lock.ownerId).toBe("owner-1");
		const again = acquirePollerLock(paths, "session-a", "owner-1");
		expect(again.ownerId).toBe("owner-1");
		expect(() => acquirePollerLock(paths, "session-b", "owner-2")).toThrow(/live poller/);
		releasePollerLock(paths, "owner-1");
		expect(acquirePollerLock(paths, "session-b", "owner-2").ownerId).toBe("owner-2");
	});

	test("release only removes the lock when the stored identity matches", () => {
		const paths = tempStateDir();
		acquirePollerLock(paths, "s", "mine");
		releasePollerLock(paths, "not-mine");
		const lock = acquirePollerLock(paths, "s", "mine");
		expect(lock.ownerId).toBe("mine");
		releasePollerLock(paths, "mine");
	});

	test("malformed lock content fails closed with its path", () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.pollerLockPath, "garbage");
		expect(() => acquirePollerLock(paths, "s", "o")).toThrow(/poller\.lock/);
	});
});

describe("withStateLock", () => {
	test("serializes read/modify/write and releases in finally even on error", async () => {
		const paths = tempStateDir();
		const order: string[] = [];
		const first = withStateLock(paths, () => {
			order.push("first");
			throw new Error("boom");
		});
		await expect(first).rejects.toThrow("boom");
		order.push("second");
		await withStateLock(paths, () => {
			order.push("third");
		});
		expect(order).toEqual(["first", "second", "third"]);
		expect(statSync(paths.stateDir, { throwIfNoEntry: false })?.isDirectory?.() ?? true).toBe(true);
	});
	test("contended lock times out after one second rather than hanging", async () => {
		const paths = tempStateDir();
		mkdirSync(paths.stateDir, { recursive: true });
		writeFileSync(paths.stateLockPath, JSON.stringify({ ownerId: "foreign", pid: process.pid, sessionId: "x", createdAt: 0 }));
		const started = Date.now();
		await expect(withStateLock(paths, () => 1)).rejects.toThrow(/Timed out|state\.lock/);
		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
	});
});
