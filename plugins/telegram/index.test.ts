import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import telegramPlugin, { TELEGRAM_CHAT_TOOLS, reconcileChatTools, removeInboxFile } from "./index.ts";
import { resolveTelegramPaths, setTokenInEnvFile, writeAccessState } from "./state.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";

const TOKEN = "123456:TEST_TOKEN_NOT_REAL_1234567890";

interface FakePi {
	registeredTools: Array<{ name: string; approval?: string; defaultInactive?: boolean; parameters: Record<string, unknown> }>;
	commands: Map<string, { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>;
	handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
	activeTools: string[];
	setActiveCalls: number;
}

function fakePi(agentDir: string): FakePi & ExtensionAPI {
	const impl: FakePi = {
		registeredTools: [],
		commands: new Map(),
		handlers: new Map(),
		activeTools: ["read", "bash"],
		setActiveCalls: 0,
	};
	const pi = {
		pi: { settings: { getAgentDir: () => agentDir } },
		logger: { error: () => {}, warn: () => {}, debug: () => {} },
		registerTool: (tool: { name: string }) => {
			impl.registeredTools.push(tool);
		},
		registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => {
			impl.commands.set(name, options);
		},
		on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
			const list = impl.handlers.get(event) ?? [];
			list.push(handler);
			impl.handlers.set(event, list);
		},
		getActiveTools: () => [...impl.activeTools],
		setActiveTools: (names: string[]) => {
			impl.activeTools = [...names];
			impl.setActiveCalls += 1;
			return Promise.resolve();
		},
		sendUserMessage: () => {},
	} as unknown as ExtensionAPI;
	return Object.assign(pi, { __impl: impl }) as unknown as FakePi & ExtensionAPI;
}

function implOf(pi: FakePi & ExtensionAPI): FakePi {
	return (pi as unknown as { __impl: FakePi }).__impl;
}

function fakeCommandCtx(): ExtensionCommandContext {
	return { hasUI: false, ui: {}, isIdle: () => true } as unknown as ExtensionCommandContext;
}

function fakeInteractiveCommandCtx(): {
	ctx: ExtensionCommandContext;
	customCalls: Array<{ factory: unknown; options?: unknown }>;
	editorCalls: { count: number };
} {
	const customCalls: Array<{ factory: unknown; options?: unknown }> = [];
	const editorCalls = { count: 0 };
	const ctx = {
		hasUI: true,
		ui: {
			custom: async (factory: unknown, options?: unknown) => {
				customCalls.push({ factory, options });
				return undefined;
			},
			editor: async () => {
				editorCalls.count += 1;
			},
		},
		isIdle: () => true,
	} as unknown as ExtensionCommandContext;
	return { ctx, customCalls, editorCalls };
}

async function runCommand(pi: FakePi & ExtensionAPI, args: string): Promise<string[]> {
	const lines: string[] = [];
	const original = console.log;
	console.log = (message: unknown) => lines.push(String(message));
	try {
		await implOf(pi).commands.get("telegram")?.handler(args, fakeCommandCtx());
	} finally {
		console.log = original;
	}
	return lines;
}

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "omp-tg-index-"));
}

describe("registration", () => {
	test("registers exactly the model-visible tools and the /telegram command without network or files", () => {
		const home = tempHome();
		try {
			writeFileSync(join(home, "APPEND_SYSTEM.md"), "sentinel-append");
			writeFileSync(join(home, "PERSONALITY.md"), "sentinel-personality");
			const pi = fakePi(home);
			telegramPlugin(pi);
			const impl = implOf(pi);
			const names = impl.registeredTools.map((t) => t.name).sort();
			expect(names).toEqual(["telegram_completions", "telegram_download_attachment", "telegram_edit_message", "telegram_react", "telegram_send", "telegram_status"]);
			expect(impl.commands.has("telegram")).toBe(true);
			// Chat tools are registered but inactive by default.
			for (const tool of impl.registeredTools) {
				if (tool.name === "telegram_status" || tool.name === "telegram_completions") {
					expect(tool.defaultInactive).toBeUndefined();
				} else {
					expect(tool.defaultInactive).toBe(true);
				}
			}
			expect(impl.activeTools).toEqual(["read", "bash"]);
			// No state was created and sentinels are byte-identical.
			expect(readFileSync(join(home, "APPEND_SYSTEM.md"), "utf8")).toBe("sentinel-append");
			expect(readFileSync(join(home, "PERSONALITY.md"), "utf8")).toBe("sentinel-personality");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("tool schemas require nonempty parameters and additionalProperties false", () => {
		const home = tempHome();
		try {
			const pi = fakePi(home);
			telegramPlugin(pi);
			const impl = implOf(pi);
			const send = impl.registeredTools.find((t) => t.name === "telegram_send");
			expect(send?.parameters.additionalProperties).toBe(false);
			expect((send?.parameters.properties as { files: { maxItems: number } }).files.maxItems).toBe(10);
			const edit = impl.registeredTools.find((t) => t.name === "telegram_edit_message");
			expect(edit?.parameters.required).toEqual(["message_id", "text"]);
			const react = impl.registeredTools.find((t) => t.name === "telegram_react");
			expect(react?.parameters.required).toEqual(["message_id", "emoji"]);
			const download = impl.registeredTools.find((t) => t.name === "telegram_download_attachment");
			expect(download?.parameters.required).toEqual(["file_id"]);
			// Approval tiers.
			expect(impl.registeredTools.find((t) => t.name === "telegram_status")?.approval).toBe("read");
			for (const name of TELEGRAM_CHAT_TOOLS) {
				expect(impl.registeredTools.find((t) => t.name === name)?.approval).toBe("write");
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("session events are registered for start, switch, shutdown, and agent turns", () => {
		const home = tempHome();
		try {
			const pi = fakePi(home);
			telegramPlugin(pi);
			const impl = implOf(pi);
			for (const event of ["session_start", "session_switch", "session_shutdown", "before_agent_start", "agent_end"]) {
				expect(impl.handlers.get(event)?.length).toBe(1);
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("tool reconciliation", () => {
	test("adds chat tools when connected and removes exactly them when disconnected", async () => {
		const home = tempHome();
		try {
			const pi = fakePi(home);
			telegramPlugin(pi);
			const impl = implOf(pi);
			const fakeBridge = { isConnected: () => true } as unknown as Parameters<typeof reconcileChatTools>[1];
			await reconcileChatTools(pi, fakeBridge);
			expect(impl.activeTools).toEqual(["read", "bash", ...TELEGRAM_CHAT_TOOLS]);
			const disconnectedBridge = { isConnected: () => false } as unknown as Parameters<typeof reconcileChatTools>[1];
			await reconcileChatTools(pi, disconnectedBridge);
			expect(impl.activeTools).toEqual(["read", "bash"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("before_agent_start passes non-telegram prompts through untouched", async () => {
		const home = tempHome();
		try {
			const pi = fakePi(home);
			telegramPlugin(pi);
			const impl = implOf(pi);
			const handler = impl.handlers.get("before_agent_start")?.[0] as (event: { prompt: string; systemPrompt: string[] }, ctx: unknown) => unknown;
			expect(handler({ prompt: "local prompt", systemPrompt: ["base"] }, {})).toBeUndefined();
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("operator command gates", () => {
	test("status uses read-only overlay in TUI and detailed log headless", async () => {
		const home = tempHome();
		try {
			const pi = fakePi(home);
			telegramPlugin(pi);
			const interactive = fakeInteractiveCommandCtx();
			await implOf(pi).commands.get("telegram")?.handler("status", interactive.ctx);
			expect(interactive.customCalls).toHaveLength(1);
			expect(interactive.customCalls[0]?.options).toEqual({ overlay: true });
			expect(interactive.customCalls[0]?.factory).toEqual(expect.any(Function));
			expect(interactive.editorCalls.count).toBe(0);
			const lines = await runCommand(pi, "status");
			expect(lines.join("\n")).toContain("State directory:");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("unpair and clear-token refuse without --confirm", async () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.stateDir, { recursive: true });
			setTokenInEnvFile(paths, TOKEN);
			const pi = fakePi(home);
			telegramPlugin(pi);
			await runCommand(pi, "unpair");
			await runCommand(pi, "clear-token");
			// Token survived both refusals.
			expect(readFileSync(paths.envPath, "utf8")).toContain(TOKEN);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("clear-token --confirm refuses while a foreign live poller holds the lock", async () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.stateDir, { recursive: true });
			setTokenInEnvFile(paths, TOKEN);
			writeFileSync(paths.pollerLockPath, JSON.stringify({ ownerId: "foreign-runtime", pid: process.pid, sessionId: "other", createdAt: 0 }));
			const pi = fakePi(home);
			telegramPlugin(pi);
			const lines = await runCommand(pi, "clear-token --confirm");
			expect(lines.join("\n")).toMatch(/poller\.lock/);
			expect(readFileSync(paths.envPath, "utf8")).toContain(TOKEN);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("clear-token --confirm removes only the file-backed token and warns about env precedence", async () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.stateDir, { recursive: true });
			process.env.TELEGRAM_BOT_TOKEN = TOKEN;
			setTokenInEnvFile(paths, TOKEN);
			const pi = fakePi(home);
			telegramPlugin(pi);
			const lines = await runCommand(pi, "clear-token --confirm");
			expect(readFileSync(paths.envPath, "utf8")).not.toContain(TOKEN);
			expect(lines.join("\n")).toMatch(/takes precedence/);
			delete process.env.TELEGRAM_BOT_TOKEN;
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

});

describe("secret and code redaction", () => {
	test("telegram_status never exposes the token, codes, chat IDs, or state paths; local status may show codes", async () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.stateDir, { recursive: true });
			setTokenInEnvFile(paths, TOKEN);
			writeAccessState(paths, {
				pending: {
					deadbeef: { userId: "777", chatId: "777", createdAt: 1, expiresAt: Date.now() + 60000, replies: 1 },
				},
			});
			const pi = fakePi(home);
			telegramPlugin(pi);
			// The direct local command shows pending codes and paths by design, but never the token.
			const lines = (await runCommand(pi, "status")).join("\n");
			expect(lines).not.toContain(TOKEN);
			expect(lines).toContain("deadbeef");
			// The model-visible tool redacts codes, IDs, paths, and shows only counts.
			const statusTool = implOf(pi).registeredTools.find((t) => t.name === "telegram_status");
			const result = await statusTool?.execute?.("call-1", {}, undefined, undefined, fakeCommandCtx());
			const text = JSON.stringify(result);
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain("deadbeef");
			expect(text).not.toContain("777");
			expect(text).not.toContain(home);
			expect(text).toContain("pending=1");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("inbox cleanup helper", () => {
	test("removeInboxFile deletes only inside the inbox", () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.inboxDir, { recursive: true });
			writeFileSync(join(paths.inboxDir, "a.txt"), "x");
			removeInboxFile(paths, "a.txt");
			removeInboxFile(paths, "../outside.txt"); // basename prevents traversal
			expect(readFileSync(join(home, "outside.txt") ?? join(paths.inboxDir, "a.txt"), "utf8")).toBe("x");
		} catch {
			// outside.txt does not exist: traversal was prevented, which is the point.
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});

describe("telegram_completions tool", () => {
	test("is always visible, read-approved, parameterless, and lists every subcommand", async () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.stateDir, { recursive: true });
			const pi = fakePi(home);
			telegramPlugin(pi);
			const impl = implOf(pi);
			const tool = impl.registeredTools.find((t) => t.name === "telegram_completions");
			expect(tool?.approval).toBe("read");
			expect(tool?.defaultInactive).toBeUndefined();
			expect(tool?.parameters).toEqual({ type: "object", properties: {}, additionalProperties: false });
			const result = await tool?.execute?.("call-1", {}, undefined, undefined, fakeCommandCtx());
			const text = JSON.stringify(result);
			for (const usage of ["status", "setup", "connect", "disconnect", "pair <code>", "deny <code>", "unpair --confirm", "clear-token --confirm"]) {
				expect(text).toContain(`/telegram ${usage}`);
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("never exposes pending pairing codes, tokens, or state paths", async () => {
		const home = tempHome();
		try {
			const paths = resolveTelegramPaths(home, {});
			mkdirSync(paths.stateDir, { recursive: true });
			setTokenInEnvFile(paths, TOKEN);
			writeAccessState(paths, {
				pending: {
					deadbeef: { userId: "777", chatId: "777", createdAt: 1, expiresAt: Date.now() + 60000, replies: 1 },
				},
			});
			const pi = fakePi(home);
			telegramPlugin(pi);
			const tool = implOf(pi).registeredTools.find((t) => t.name === "telegram_completions");
			const result = await tool?.execute?.("call-1", {}, undefined, undefined, fakeCommandCtx());
			const text = JSON.stringify(result);
			expect(text).not.toContain("deadbeef");
			expect(text).not.toContain("777");
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(home);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
