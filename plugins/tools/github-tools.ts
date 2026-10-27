/** GitHub PR tools: one-call PR discovery and full details with failure logs. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { isRecord } from "./usage.ts";
import {
	buildPrDetails,
	flattenPrComments,
	formatPrDiscovery,
	PR_COMMENTS_QUERY,
	type PrCheckRun,
	type PrCommentsData,
	type PrInfo,
	type StackLayer,
} from "./github.ts";
import { runCli } from "./cli.ts";
import { toolText } from "./tool-result.ts";

/** Run a gh CLI command; map common failures to actionable messages. */
async function runGh(pi: ExtensionAPI, args: string[]) {
	return runCli(pi, "gh", args, {
		keepEmpty: true,
		notFound: "gh CLI not found — install with `brew install gh`.",
		mappings: [{ pattern: /not logged into|not authenticated|auth login/i, message: "gh is not authenticated — run `gh auth login`." }],
	});
}

/** Extract the Actions run id from a check-run `link`/`details_url`. */
function runIdFromLink(link: string): string | undefined {
	const m = link.match(/\/actions\/runs\/(\d+)/);
	return m?.[1];
}

export function registerGithubTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "look_for_prs",
		label: "Look For PRs",
		description:
			"Discover what PR(s) exist for the current branch before fetching details: the single PR (number/title/url/state/draft/head→base) when the branch maps to one, and the gh-stack layers (ordered branches + each layer's PR number/state) when the branch is part of a stack. Reports neither when the branch has no PR and is not stacked. Call this to find PR numbers; then call get_pr_details for checks/comments on a specific one.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		approval: "read",
		execute: async () => {
			const branchR = await runGh(pi, ["branch", "--show-current"]);
			const branch = branchR.ok ? branchR.text : "";
			const prR = await runGh(pi, ["pr", "view", "--json", "number,title,url,state,isDraft,headRefName,baseRefName"]);
			const pr = prR.ok ? (JSON.parse(prR.text) as PrInfo) : undefined;
			const stackR = await runGh(pi, ["stack", "view", "--json"]);
			let stack: StackLayer[] | undefined;
			if (stackR.ok) {
				try {
					const parsed = JSON.parse(stackR.text) as unknown;
					if (Array.isArray(parsed)) {
						stack = parsed as StackLayer[];
					} else if (isRecord(parsed) && Array.isArray(parsed.stack)) {
						stack = parsed.stack as StackLayer[];
					}
				} catch {
					// not in a stack; leave undefined
				}
			}
			return toolText(formatPrDiscovery(branch, pr, stack));
		},
	});

	pi.registerTool({
		name: "get_pr_details",
		label: "Get PR Details",
		description:
			"THE tool for PR data — after `look_for_prs` has found the number, call this whenever a task touches a pull request's checks or comments, instead of chaining `gh pr checks`, `gh api graphql`, or `gh pr view`. One call returns, as JSON: PR identity (number/title/url/state/draft/head→base branches), CI checks split into passing (metadata) / failed (metadata + failure log) / pending plus a summary, and every open comment (issue comments, reviews, inline threads with path:line and resolved/outdated state). Accepts a PR number or URL; defaults to the current branch's PR.",
		parameters: {
			type: "object",
			properties: {
				pr: { type: "string", description: "PR number or URL (default: current branch's PR)" },
			},
			additionalProperties: false,
		},
		approval: "read",
		execute: async (_id, params: { pr?: string }) => {
			let numberArg = params.pr;
			if (numberArg === undefined) {
				const found = await runGh(pi, ["pr", "view", "--json", "number"]);
				if (!found.ok) return toolText("No PR found for the current branch — pass a PR number or URL via `pr`.", true);
				numberArg = String((JSON.parse(found.text) as { number: number }).number);
			}
			const repo = await runGh(pi, ["repo", "view", "--json", "owner,name"]);
			if (!repo.ok) return toolText(repo.text, true);
			const { owner, name } = JSON.parse(repo.text) as { owner: { login: string }; name: string };
			const num = Number.parseInt(numberArg.replace(/\D/g, ""), 10);
			if (!Number.isFinite(num)) return toolText(`Invalid PR reference: ${numberArg}`, true);

			// PR identity.
			const infoR = await runGh(pi, ["pr", "view", String(num), "--json", "number,title,url,state,isDraft,headRefName,baseRefName"]);
			if (!infoR.ok) return toolText(infoR.text, true);
			const info = JSON.parse(infoR.text) as PrInfo;

			// Check runs.
			const checksR = await runGh(pi, [
				"pr",
				"checks",
				String(num),
				"--json",
				"name,state,bucket,link,workflow,description,startedAt,completedAt",
			]);
			// `gh pr checks` exits 0 with empty stdout when no checks reported — treat as no runs.
			const checkRuns: PrCheckRun[] = checksR.ok && checksR.text.trim().length > 0 ? (JSON.parse(checksR.text) as PrCheckRun[]) : [];

			// Comments via the shared GraphQL query.
			const commentsR = await runGh(pi, [
				"api",
				"graphql",
				"-f",
				`query=${PR_COMMENTS_QUERY}`,
				"-F",
				`owner=${owner.login}`,
				"-F",
				`repo=${name}`,
				"-F",
				`number=${num}`,
			]);
			if (!commentsR.ok) return toolText(commentsR.text, true);
			const payload = JSON.parse(commentsR.text) as { data?: PrCommentsData; errors?: { message: string }[] };
			if (payload.errors?.length) return toolText(`GraphQL: ${payload.errors.map((e) => e.message).join("; ")}`, true);
			const flat = payload.data ? flattenPrComments(payload.data) : undefined;
			if (!flat) return toolText(`PR #${num} not found in ${owner.login}/${name}.`, true);

			const details = buildPrDetails(info, checkRuns, flat.comments);

			// Fill failure logs. Parallelize; cap each log to keep the payload sane.
			const LOG_CAP = 8000;
			await Promise.all(
				details.checks.failed.map(async (f) => {
					const runId = runIdFromLink(f.link);
					if (!runId) {
						f.log = "(no run id in check link — cannot fetch log)";
						return;
					}
					const logR = await runGh(pi, ["run", "view", runId, "--log-failed"]);
					const raw = logR.ok ? logR.text : `(failed to fetch log: ${logR.text})`;
					f.log = raw.length > LOG_CAP ? `…(truncated)…\n${raw.slice(-LOG_CAP)}` : raw;
				}),
			);

			return toolText(JSON.stringify(details, null, 2));
		},
	});
}
