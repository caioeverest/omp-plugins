/**
 * Private, atomic state handling for the Telegram plugin.
 *
 * Invariants enforced here:
 * - Credentials resolve from the process environment first, then the exact
 *   `TELEGRAM_BOT_TOKEN=` line in `.env`; every unrelated `.env` line is
 *   preserved on mutation.
 * - The state directory is mode 0700 and every state file mode 0600,
 *   published through temp-file + rename.
 * - Malformed state files fail closed with the offending path; they never
 *   silently reopen pairing or reset cursors.
 * - Every cross-process read/modify/write of `.env` or `access.json` is
 *   serialized through a short-lived `state.lock` with exclusive creation.
 */

import { randomBytes, randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const TOKEN_ENV_VAR = "TELEGRAM_BOT_TOKEN";
export const TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;

/** One hour pairing-code validity. */
export const PENDING_TTL_MS = 60 * 60 * 1000;
/** Maximum live pending pairing requests. */
export const MAX_PENDING = 3;

export interface TelegramPaths {
	stateDir: string;
	envPath: string;
	accessPath: string;
	cursorPath: string;
	stateLockPath: string;
	pollerLockPath: string;
	inboxDir: string;
}

export interface TelegramOwner {
	userId: string;
	chatId: string;
	username?: string;
	displayName?: string;
}

export interface TelegramPending {
	userId: string;
	chatId: string;
	username?: string;
	displayName?: string;
	createdAt: number;
	expiresAt: number;
	/** Pairing instructions successfully delivered (0 = first instruction pending, 2 = instruction + reminder both sent). */
	replies: number;
}

export interface TelegramAccessState {
	botId?: number;
	owner?: TelegramOwner;
	pending: Record<string, TelegramPending>;
}

export interface TelegramCursorState {
	botId: number;
	lastUpdateId: number;
}

export interface LockInfo {
	ownerId: string;
	pid: number;
	sessionId: string;
	createdAt: number;
}

export function resolveTelegramPaths(agentDir: string, env: NodeJS.ProcessEnv = process.env): TelegramPaths {
	const override = env.OMP_TELEGRAM_STATE_DIR?.trim();
	const stateDir = override && override.length > 0 ? (override.startsWith("/") ? override : `${agentDir}/${override}`) : join(agentDir, "telegram");
	const absolute = stateDir.startsWith("/") ? stateDir : `${agentDir}/${stateDir}`;
	return {
		stateDir: absolute,
		envPath: join(absolute, ".env"),
		accessPath: join(absolute, "access.json"),
		cursorPath: join(absolute, "cursor.json"),
		stateLockPath: join(absolute, "state.lock"),
		pollerLockPath: join(absolute, "poller.lock"),
		inboxDir: join(absolute, "inbox"),
	};
}

// ---------------------------------------------------------------------------
// atomic file publication

function ensurePrivateDir(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	try {
		chmodSync(dir, 0o700);
	} catch {
		// best effort on platforms without POSIX modes
	}
}

function atomicWrite(path: string, data: string, mode: number): void {
	ensurePrivateDir(dirname(path));
	const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		writeFileSync(tmp, data, { mode });
		chmodSync(tmp, mode);
		renameSync(tmp, path);
	} catch (error) {
		try {
			rmSync(tmp, { force: true });
		} catch {
			// ignore cleanup failure
		}
		throw error;
	}
}

// ---------------------------------------------------------------------------
// credentials

export function isValidTokenFormat(token: string): boolean {
	return TOKEN_PATTERN.test(token);
}

export interface ResolvedToken {
	token: string;
	source: "environment" | "file";
}

function tokenFromFile(envPath: string): string | undefined {
	if (!existsSync(envPath)) return undefined;
	const content = readFileSync(envPath, "utf8");
	for (const line of content.split("\n")) {
		const match = line.match(/^TELEGRAM_BOT_TOKEN=(.*)$/);
		if (match) {
			const value = match[1].trim();
			return value.length > 0 ? value : undefined;
		}
	}
	return undefined;
}

/** Environment variable wins, then the exact `TELEGRAM_BOT_TOKEN=` line in `.env`. */
export function readTelegramToken(paths: TelegramPaths, env: NodeJS.ProcessEnv = process.env): ResolvedToken | undefined {
	const fromEnv = env[TOKEN_ENV_VAR]?.trim();
	if (fromEnv) return { token: fromEnv, source: "environment" };
	const fromFile = tokenFromFile(paths.envPath);
	if (fromFile) return { token: fromFile, source: "file" };
	return undefined;
}

/**
 * Persist a token to `.env`, preserving every unrelated line and collapsing
 * duplicate token lines. Returns the written file path.
 */
export function setTokenInEnvFile(paths: TelegramPaths, token: string): string {
	if (!isValidTokenFormat(token)) {
		throw new Error("Token does not match the BotFather format '<bot-id>:<secret>' (at least 20 secret characters).");
	}
	const existing = existsSync(paths.envPath) ? readFileSync(paths.envPath, "utf8") : "";
	const kept = existing.split("\n").filter((line) => !/^TELEGRAM_BOT_TOKEN=/.test(line));
	while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
	const trailing = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
	const next = `${kept.join("\n")}${kept.length > 0 ? "\n" : ""}${trailing}TELEGRAM_BOT_TOKEN=${token}\n`;
	atomicWrite(paths.envPath, next, 0o600);
	return paths.envPath;
}

/** Remove only file-backed token lines. Returns true when a line was removed. */
export function clearTokenFromEnvFile(paths: TelegramPaths): boolean {
	if (!existsSync(paths.envPath)) return false;
	const existing = readFileSync(paths.envPath, "utf8");
	const lines = existing.split("\n");
	const kept = lines.filter((line) => !/^TELEGRAM_BOT_TOKEN=/.test(line));
	if (kept.length === lines.length) return false;
	while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
	atomicWrite(paths.envPath, `${kept.join("\n")}\n`, 0o600);
	return true;
}

// ---------------------------------------------------------------------------
// access state

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAccessStateUnchecked(paths: TelegramPaths): TelegramAccessState | undefined {
	if (!existsSync(paths.accessPath)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(paths.accessPath, "utf8"));
	} catch {
		throw new Error(`Malformed Telegram access state at ${paths.accessPath}; refusing to reopen pairing. Fix or remove the file, then retry.`);
	}
	if (!isRecord(parsed)) {
		throw new Error(`Malformed Telegram access state at ${paths.accessPath}: not an object.`);
	}
	const state: TelegramAccessState = { pending: {} };
	if (typeof parsed.botId === "number") state.botId = parsed.botId;
	if (isRecord(parsed.owner)) {
		const owner = parsed.owner as Record<string, unknown>;
		if (typeof owner.userId === "string" && typeof owner.chatId === "string") {
			state.owner = { userId: owner.userId, chatId: owner.chatId };
			if (typeof owner.username === "string") state.owner.username = owner.username;
			if (typeof owner.displayName === "string") state.owner.displayName = owner.displayName;
		} else {
			throw new Error(`Malformed Telegram access state at ${paths.accessPath}: owner entry is incomplete.`);
		}
	}
	if (isRecord(parsed.pending)) {
		for (const [code, entry] of Object.entries(parsed.pending)) {
			if (!isRecord(entry)) {
				throw new Error(`Malformed Telegram access state at ${paths.accessPath}: pending entry for a code is not an object.`);
			}
			const p = entry as Record<string, unknown>;
			if (typeof p.userId !== "string" || typeof p.chatId !== "string" || typeof p.createdAt !== "number" || typeof p.expiresAt !== "number" || typeof p.replies !== "number") {
				throw new Error(`Malformed Telegram access state at ${paths.accessPath}: pending entry is incomplete.`);
			}
			state.pending[code] = {
				userId: p.userId,
				chatId: p.chatId,
				createdAt: p.createdAt,
				expiresAt: p.expiresAt,
				replies: p.replies,
			};
			if (typeof p.username === "string") state.pending[code].username = p.username;
			if (typeof p.displayName === "string") state.pending[code].displayName = p.displayName;
		}
	} else if (parsed.pending !== undefined) {
		throw new Error(`Malformed Telegram access state at ${paths.accessPath}: pending is not an object.`);
	}
	return state;
}

/** Read access state; missing file means no owner and no pending requests. */
export function readAccessState(paths: TelegramPaths): TelegramAccessState {
	return readAccessStateUnchecked(paths) ?? { pending: {} };
}

export function writeAccessState(paths: TelegramPaths, state: TelegramAccessState): void {
	atomicWrite(paths.accessPath, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

/** Remove expired pending entries before any decision or mutation. */
export function prunePending(state: TelegramAccessState, now: number): TelegramAccessState {
	const pending: Record<string, TelegramPending> = {};
	for (const [code, entry] of Object.entries(state.pending)) {
		if (entry.expiresAt > now) pending[code] = entry;
	}
	return { ...state, pending };
}

export interface SenderIdentity {
	userId: string;
	chatId: string;
	username?: string;
	displayName?: string;
}

export type PendingOutcome = "created" | "remind" | "silenced" | "capped";

export interface PendingTransition {
	state: TelegramAccessState;
	outcome: PendingOutcome;
	code?: string;
}

/**
 * Pure transition for an unknown private sender. Reuses the sender's live code
 * for the first instruction plus at most one reminder, caps live pending
 * requests at three, and otherwise reports "silenced"/"capped" (drop silently).
 */
export function transitionPending(state: TelegramAccessState, sender: SenderIdentity, now: number, randomCode: () => string = defaultRandomCode): PendingTransition {
	const pruned = prunePending(state, now);
	const existingEntry = Object.entries(pruned.pending).find(([, p]) => p.userId === sender.userId);
	if (existingEntry) {
		const [code, entry] = existingEntry;
		return { state: pruned, outcome: entry.replies >= 2 ? "silenced" : "remind", code };
	}
	if (Object.keys(pruned.pending).length >= MAX_PENDING) {
		return { state: pruned, outcome: "capped" };
	}
	const code = randomCode();
	const next: TelegramAccessState = {
		...pruned,
		pending: {
			...pruned.pending,
			[code]: {
				userId: sender.userId,
				chatId: sender.chatId,
				createdAt: now,
				expiresAt: now + PENDING_TTL_MS,
				replies: 0,
				username: sender.username,
				displayName: sender.displayName,
			},
		},
	};
	return { state: next, outcome: "created", code };
}

/** Increment `replies` after Telegram confirms a pairing instruction was sent. */
export function recordPairingReply(state: TelegramAccessState, code: string): TelegramAccessState {
	const entry = state.pending[code];
	if (!entry) return state;
	return { ...state, pending: { ...state.pending, [code]: { ...entry, replies: entry.replies + 1 } } };
}

export function defaultRandomCode(): string {
	return randomBytes(3).toString("hex"); // six hex characters
}

/** Admit only the exact paired userId in a private chat; never bots. */
export function isOwnerMessage(state: TelegramAccessState, userId: string, chatId: string, isBot: boolean): boolean {
	if (isBot) return false;
	if (!state.owner) return false;
	return state.owner.userId === userId && state.owner.chatId === chatId;
}

export class PairingError extends Error {}

/** Approve the exact unexpired code; sets the sole owner and clears all pending. */
export function approvePairing(state: TelegramAccessState, code: string, now: number): TelegramAccessState {
	const pruned = prunePending(state, now);
	const entry = pruned.pending[code];
	if (!entry || entry.expiresAt <= now) {
		throw new PairingError("No live pairing request matches that code.");
	}
	return {
		...pruned,
		botId: pruned.botId,
		owner: {
			userId: entry.userId,
			chatId: entry.chatId,
			username: entry.username,
			displayName: entry.displayName,
		},
		pending: {},
	};
}

/** Remove only the named live code. */
export function denyPairing(state: TelegramAccessState, code: string, now: number): TelegramAccessState {
	const pruned = prunePending(state, now);
	if (!pruned.pending[code]) return pruned;
	const pending = { ...pruned.pending };
	delete pending[code];
	return { ...pruned, pending };
}

/** Clear owner and pending. */
export function unpairOwner(state: TelegramAccessState): TelegramAccessState {
	return { ...state, owner: undefined, pending: {} };
}

// ---------------------------------------------------------------------------
// cursor

export function readCursor(paths: TelegramPaths): TelegramCursorState | undefined {
	if (!existsSync(paths.cursorPath)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(paths.cursorPath, "utf8"));
	} catch {
		throw new Error(`Malformed Telegram cursor at ${paths.cursorPath}; refusing to reset and replay or skip updates. Fix or remove the file, then retry.`);
	}
	if (!isRecord(parsed) || typeof parsed.botId !== "number" || typeof parsed.lastUpdateId !== "number") {
		throw new Error(`Malformed Telegram cursor at ${paths.cursorPath}; refusing to reset and replay or skip updates. Fix or remove the file, then retry.`);
	}
	return { botId: parsed.botId, lastUpdateId: parsed.lastUpdateId };
}

export function writeCursor(paths: TelegramPaths, cursor: TelegramCursorState): void {
	atomicWrite(paths.cursorPath, `${JSON.stringify(cursor)}\n`, 0o600);
}

export function deleteCursor(paths: TelegramPaths): void {
	try {
		unlinkSync(paths.cursorPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

// ---------------------------------------------------------------------------
// locks

function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function readLockInfo(path: string): LockInfo | undefined {
	if (!existsSync(path)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(`Malformed lock content at ${path}; failing closed instead of overwriting it.`);
	}
	if (!isRecord(parsed) || typeof parsed.ownerId !== "string" || typeof parsed.pid !== "number" || typeof parsed.sessionId !== "string" || typeof parsed.createdAt !== "number") {
		throw new Error(`Malformed lock content at ${path}; failing closed instead of overwriting it.`);
	}
	return { ownerId: parsed.ownerId, pid: parsed.pid, sessionId: parsed.sessionId, createdAt: parsed.createdAt };
}

function writeLockInfo(path: string, fd: number, info: LockInfo): void {
	writeSync(fd, `${JSON.stringify(info)}\n`);
	void path;
}

function removeLockIfIdentity(path: string, ownerId: string): boolean {
	let info: LockInfo | undefined;
	try {
		info = readLockInfo(path);
	} catch {
		return false;
	}
	if (!info || info.ownerId !== ownerId) return false;
	try {
		unlinkSync(path);
		return true;
	} catch {
		return false;
	}
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface StateLockOptions {
	timeoutMs?: number;
	sessionId?: string;
	now?: () => number;
}

/**
 * Serialize a cross-process read/modify/write through short-lived exclusive
 * creation of `state.lock`. Contention waits at most one second; a dead
 * recorded PID may be reclaimed only after re-reading the same lock identity.
 */
export async function withStateLock<T>(paths: TelegramPaths, fn: () => T | Promise<T>, options: StateLockOptions = {}): Promise<T> {
	ensurePrivateDir(paths.stateDir);
	const ownerId = `lock-${process.pid}-${randomUUID()}`;
	const deadline = (options.now ?? Date.now)() + (options.timeoutMs ?? 1000);
	let fd: number | undefined;
	for (;;) {
		try {
			fd = openSync(paths.stateLockPath, "wx");
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let info: LockInfo | undefined;
			try {
				info = readLockInfo(paths.stateLockPath);
			} catch {
				throw new Error(`Malformed lock content at ${paths.stateLockPath}; failing closed instead of overwriting it.`);
			}
			if (info && !isPidAlive(info.pid)) {
				// Reclaim only after re-reading the same lock identity.
				const reread = readLockInfo(paths.stateLockPath);
				if (reread && reread.ownerId === info.ownerId) {
					try {
						unlinkSync(paths.stateLockPath);
					} catch {
						// another process reclaimed it first
					}
				}
				continue;
			}
			if ((options.now ?? Date.now)() > deadline) {
				throw new Error(`Timed out waiting for ${paths.stateLockPath} after 1s of contention.`);
			}
			await sleep(20);
		}
	}
	try {
		writeLockInfo(paths.stateLockPath, fd, { ownerId, pid: process.pid, sessionId: options.sessionId ?? "", createdAt: (options.now ?? Date.now)() });
		return await fn();
	} finally {
		try {
			closeSync(fd);
		} catch {
			// ignore
		}
		removeLockIfIdentity(paths.stateLockPath, ownerId);
	}
}

export class PollerLockError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PollerLockError";
	}
}

/**
 * Acquire the durable single-poller lock. Repeated connect by the same runtime
 * is idempotent; a live or unknown owner fails without killing it. A dead
 * recorded PID may be reclaimed only after re-reading the same lock identity.
 */
export function acquirePollerLock(paths: TelegramPaths, sessionId: string, ownerId: string, now: () => number = Date.now): LockInfo {
	ensurePrivateDir(paths.stateDir);
	for (;;) {
		let fd: number;
		try {
			fd = openSync(paths.pollerLockPath, "wx");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let info: LockInfo;
			try {
				info = readLockInfo(paths.pollerLockPath) as LockInfo;
			} catch (readError) {
				throw readError instanceof Error ? readError : new PollerLockError(`Malformed poller.lock at ${paths.pollerLockPath}.`);
			}
			if (!info) {
				// Exclusive creation succeeded above, so this is unreachable, but fail closed.
				throw new PollerLockError(`Missing poller.lock content at ${paths.pollerLockPath}.`);
			}
			if (info.ownerId === ownerId) return info; // idempotent re-connect
			if (isPidAlive(info.pid)) {
				throw new PollerLockError(`Another live poller holds ${paths.pollerLockPath} (pid ${info.pid}, session ${info.sessionId || "unknown"}). Disconnect it first.`);
			}
			// Dead pid: reclaim only after re-reading the same lock identity.
			const reread = readLockInfo(paths.pollerLockPath);
			if (reread && reread.ownerId === info.ownerId) {
				try {
					unlinkSync(paths.pollerLockPath);
				} catch {
					// someone else reclaimed it
					continue;
				}
				continue;
			}
			continue;
		}
		try {
			const info: LockInfo = { ownerId, pid: process.pid, sessionId, createdAt: now() };
			writeLockInfo(paths.pollerLockPath, fd, info);
			return info;
		} finally {
			closeSync(fd);
		}
	}
}

/** Release this runtime's poller lock only when the stored identity still matches. */
export function releasePollerLock(paths: TelegramPaths, ownerId: string): void {
	if (!existsSync(paths.pollerLockPath)) return;
	removeLockIfIdentity(paths.pollerLockPath, ownerId);
}

/** Read the current poller lock for operator-facing diagnostics. */
export function readPollerLock(paths: TelegramPaths): LockInfo | undefined {
	return readLockInfo(paths.pollerLockPath);
}

/** True when a foreign (other ownerId) live poller currently holds the lock. */
export function hasForeignLivePoller(paths: TelegramPaths, ownerId: string): boolean {
	const info = readLockInfo(paths.pollerLockPath);
	if (!info) return false;
	if (info.ownerId === ownerId) return false;
	return isPidAlive(info.pid);
}

/** Used by the inbox filename generator; exported for tests. */
export function randomInboxStem(): string {
	return randomBytes(6).toString("hex");
}

/** Ensure the state and inbox directories exist with private modes. */
export function ensureStateLayout(paths: TelegramPaths): void {
	ensurePrivateDir(paths.stateDir);
	ensurePrivateDir(paths.inboxDir);
}

/** Best-effort mode normalization used when files are moved into place. */
export function enforceFileMode(path: string, mode: number): void {
	try {
		chmodSync(path, mode);
	} catch {
		// platform without POSIX modes
	}
}

/** Stat helper for tests and size checks. */
export function fileSize(path: string): number {
	return statSync(path).size;
}
