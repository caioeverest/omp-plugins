/** Team extension offer: prompts once per plugin version to install shared packages. */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "./usage.ts";
import { runCli } from "./cli.ts";

/** Extension packages every Everest engineer should have (omp install specs). */
const TEAM_EXTENSIONS = [
	"@hypabolic/pi-hypa@1.2.0",
	"npm:pi-rtk-optimizer@0.9.0",
	"git:github.com/jonjonrankin/pi-caveman@bd0cc77fa74379de1c287e6dc0033d9b16a3a4dc",
	"npm:@dietrichgebert/ponytail@5.3.2",
] as const;

/** Persisted state for the team-extension offer. */
interface ToolsConfig {
	teamExtensionsVersion?: string;
}

function loadToolsConfig(agentDir: string): ToolsConfig {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(agentDir, "omp-tools.json"), "utf8"));
		if (isRecord(parsed) && typeof parsed.teamExtensionsVersion === "string") {
			return { teamExtensionsVersion: parsed.teamExtensionsVersion };
		}
	} catch {
		// Missing or malformed state is equivalent to a fresh install.
	}
	return {};
}

function saveToolsConfig(agentDir: string, config: ToolsConfig): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(join(agentDir, "omp-tools.json"), `${JSON.stringify(config, null, "\t")}\n`);
}

function readPluginVersion(): string {
	try {
		const parsed: unknown = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
		if (isRecord(parsed) && typeof parsed.version === "string") return parsed.version;
	} catch {
		// A missing manifest should not prevent the tools plugin from loading.
	}
	return "0.0.0";
}

const PLUGIN_VERSION = readPluginVersion();

/** Numeric dotted-version compare: positive when a > b, negative when a < b. */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
	const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/** Package name a spec registers under in the plugins registry. */
export function specPackageName(spec: string): string {
	const stripped = spec
		.replace(/^(npm|git):/i, "")
		.replace(/\.git$/, "")
		.replace(/#.*$/, "");
	if (stripped.startsWith("@")) {
		const match = stripped.match(/^(@[^/]+\/[^@]+)/);
		return match ? match[1] : stripped;
	}
	return (stripped.split("/").pop() ?? stripped).replace(/@[^@]*$/, "");
}

/**
 * Plugin names installed from a marketplace, parsed from `omp plugin list --json`
 * output. Registry ids carry the marketplace suffix; local-path marketplaces are
 * registered with an `omp-` prefix, so both `@<market>` and `@omp-<market>` match.
 * Returns undefined when the output is unparseable.
 */
export function parseInstalledMarketplacePluginNames(json: string, market: string): string[] | undefined {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!isRecord(parsed) || !Array.isArray(parsed.marketplace)) return undefined;
		const suffixes = [`@${market}`, `@omp-${market}`];
		const names = new Set<string>();
		for (const group of parsed.marketplace) {
			if (!isRecord(group) || typeof group.id !== "string") continue;
			const suffix = suffixes.find((s) => group.id.endsWith(s));
			if (suffix) names.add(group.id.slice(0, -suffix.length));
		}
		return [...names];
	} catch {
		return undefined;
	}
}

export async function offerTeamExtensions(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean | undefined> {
	if (!ctx.hasUI || typeof ctx.ui?.confirm !== "function") return;

	const agentDir = pi.pi.settings.getAgentDir();
	const config = loadToolsConfig(agentDir);
	if (config.teamExtensionsVersion !== undefined && compareVersions(PLUGIN_VERSION, config.teamExtensionsVersion) <= 0) return;

	const registryPath = join(dirname(agentDir), "plugins", "package.json");
	const installed = new Set<string>();
	if (existsSync(registryPath)) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(registryPath, "utf8"));
			if (isRecord(parsed) && isRecord(parsed.dependencies)) {
				for (const name of Object.keys(parsed.dependencies)) installed.add(name);
			}
		} catch {
			// Unreadable registry: offer every extension.
		}
	}

	const missing = TEAM_EXTENSIONS.filter((spec) => !installed.has(specPackageName(spec)));
	if (missing.length === 0) return;

	const install = await ctx.ui.confirm(
		"Install team extensions?",
		`Everest engineers share a few extension packages:\n\n${missing.map((name) => `- ${name}`).join("\n")}\n\nRuns: omp install <name> for each.`,
	);
	if (!install) {
		saveToolsConfig(agentDir, { teamExtensionsVersion: PLUGIN_VERSION });
		return;
	}

	for (const spec of missing) {
		const result = await runCli(pi, "omp", ["install", spec], { timeout: 120_000, notFound: "omp CLI not found" });
		if (!result.ok) {
			ctx.ui.notify(`Failed to install ${spec}: ${result.text}`, "error");
			return;
		}
	}
	saveToolsConfig(agentDir, { teamExtensionsVersion: PLUGIN_VERSION });

	const restart = await ctx.ui.confirm(
		"Restart omp to activate?",
		"Extensions load at process start only; there is no in-process reload. Your session persists; relaunch with `omp -c` to continue it.\n\nRestart now?",
	);
	if (restart) {
		ctx.shutdown();
		setTimeout(() => process.exit(0), 1500);
		return true;
	}
	ctx.ui.notify("Team extensions installed; available on the next omp start.", "info");
	return false;
}
