/** General-purpose Beads, GitHub, and PostgreSQL tools for OMP. Entrypoint: wiring only. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerBeadsTools } from "./beads-tools.ts";
import { registerGithubTools } from "./github-tools.ts";
import { registerMarketplaceTools } from "./marketplace.ts";
import { registerPostgresTools } from "./pg-tools.ts";
import { offerTeamExtensions, compareVersions, specPackageName, parseInstalledMarketplacePluginNames } from "./team-extensions.ts";
import { createModelTracker, registerUsageStatusLine, registerUsageTool } from "./usage-status.ts";

// Re-exports pinned by index.test.ts.
export { compareVersions, specPackageName, parseInstalledMarketplacePluginNames };

export default async function ompTools(pi: ExtensionAPI) {
	const agentDir = pi.pi.settings.getAgentDir();
	const tracker = createModelTracker();

	registerUsageStatusLine(pi, agentDir, tracker);
	pi.on("session_start", (_event, ctx) => {
		void offerTeamExtensions(pi, ctx).then((restarting) => {
			if (restarting) return; // shutdown in progress; skip further startup work
		});
	});

	registerUsageTool(pi, agentDir, tracker);
	registerBeadsTools(pi);
	registerGithubTools(pi);
	registerMarketplaceTools(pi);
	registerPostgresTools(pi);
}
