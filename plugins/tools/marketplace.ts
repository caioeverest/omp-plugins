/** Marketplace management: refresh one catalog and upgrade every plugin from it. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { runCli } from "./cli.ts";
import { toolText } from "./tool-result.ts";
import { parseInstalledMarketplacePluginNames } from "./team-extensions.ts";

export function registerMarketplaceTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "update_marketplace",
		label: "Update Marketplace",
		description:
			"Refresh one OMP marketplace's catalog and upgrade every plugin installed from it, in one call. " +
			"Runs `omp plugin marketplace update <marketplace>`, finds installed plugins whose registry id ends with @<marketplace> (or the omp- prefixed alias), " +
			"then runs `omp plugin upgrade <plugin>@<marketplace>` for each and reports per-plugin results. " +
			"Restart OMP afterwards for hooks, custom tools, or extension modules to load the new versions.",
		parameters: {
			type: "object",
			properties: {
				marketplace: { type: "string", description: "Marketplace name as shown by `omp plugin marketplace list` (e.g. everest)" },
			},
			required: ["marketplace"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: { marketplace: string }) => {
			const market = params.marketplace;
			const update = await runCli(pi, "omp", ["plugin", "marketplace", "update", market], { timeout: 120_000, notFound: "omp CLI not found" });
			if (!update.ok) return toolText(update.text, true);

			const list = await runCli(pi, "omp", ["plugin", "list", "--json"], { timeout: 120_000, notFound: "omp CLI not found" });
			if (!list.ok) return toolText(list.text, true);
			const pluginNames = parseInstalledMarketplacePluginNames(list.text, market);
			if (pluginNames === undefined) return toolText("Could not parse `omp plugin list --json` output.", true);
			if (pluginNames.length === 0) {
				return toolText(`Catalog for ${market} updated. No plugins are installed from it.`);
			}

			const results: string[] = [];
			let failed = false;
			for (const name of pluginNames) {
				const spec = `${name}@${market}`;
				const r = await runCli(pi, "omp", ["plugin", "upgrade", spec], { timeout: 120_000, notFound: "omp CLI not found" });
				failed = failed || !r.ok;
				results.push(`${r.ok ? "OK" : "FAILED"} ${spec}${r.ok ? "" : ` — ${r.text}`}`);
			}
			const lines = [
				`Catalog for ${market} updated. Upgraded ${pluginNames.length} plugin(s):`,
				...results,
				"",
				"Restart OMP for hooks, custom tools, or extension modules to pick up the new versions.",
			];
			return toolText(lines.join("\n"), failed);
		},
	});
}
