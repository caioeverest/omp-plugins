/**
 * GitHub PR helpers — pure query/format functions used by the
 * `get_pr_details` tool. No I/O here.
 */

/** GraphQL query: every comment surface of a PR in one round trip. */
export const PR_COMMENTS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      url
      state
      author { login }
      comments(first: 100) {
        nodes { author { login } body createdAt url }
      }
      reviews(first: 100) {
        nodes { author { login } state body submittedAt }
      }
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 100) {
            nodes { author { login } body createdAt url }
          }
        }
      }
    }
  }
}`;

export interface PrInfo {
	number: number;
	title: string;
	url: string;
	state: string;
	headRefName: string;
	baseRefName: string;
	isDraft: boolean;
}

export interface PrCommentNode {
	author?: { login: string } | null;
	body: string;
	createdAt: string;
	url: string;
}

export interface PrReviewNode {
	author?: { login: string } | null;
	state: string;
	body: string;
	submittedAt: string;
}

export interface PrReviewThreadNode {
	isResolved: boolean;
	isOutdated: boolean;
	path: string | null;
	line: number | null;
	comments: { nodes: PrCommentNode[] };
}

export interface PrCommentsData {
	repository: {
		pullRequest: {
			title: string;
			url: string;
			state: string;
			author?: { login: string } | null;
			comments: { nodes: PrCommentNode[] };
			reviews: { nodes: PrReviewNode[] };
			reviewThreads: { nodes: PrReviewThreadNode[] };
		} | null;
	} | null;
}

/** One flattened comment row for agent consumption. */
export interface FlatComment {
	kind: "comment" | "review" | "thread";
	author: string;
	createdAt: string;
	body: string;
	url?: string;
	state?: string;
	path?: string;
	line?: number;
	resolved?: boolean;
	outdated?: boolean;
}

/** Flatten the GraphQL response into a chronologically sorted comment list. */
export function flattenPrComments(
	data: PrCommentsData,
): { title: string; url: string; state: string; comments: FlatComment[] } | undefined {
	const pr = data.repository?.pullRequest;
	if (!pr) return undefined;
	const flat: FlatComment[] = [];
	for (const c of pr.comments.nodes) {
		flat.push({ kind: "comment", author: c.author?.login ?? "unknown", createdAt: c.createdAt, body: c.body, url: c.url });
	}
	for (const r of pr.reviews.nodes) {
		if (!r.body.trim()) continue; // empty review bodies carry no signal; inline threads cover the rest
		flat.push({ kind: "review", author: r.author?.login ?? "unknown", createdAt: r.submittedAt, body: r.body, state: r.state });
	}
	for (const t of pr.reviewThreads.nodes) {
		for (const c of t.comments.nodes) {
			flat.push({
				kind: "thread",
				author: c.author?.login ?? "unknown",
				createdAt: c.createdAt,
				body: c.body,
				url: c.url,
				path: t.path ?? undefined,
				line: t.line ?? undefined,
				resolved: t.isResolved,
				outdated: t.isOutdated,
			});
		}
	}
	flat.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return { title: pr.title, url: pr.url, state: pr.state, comments: flat };
}

// ---------------------------------------------------------------------------
// look_for_prs — current-branch PR + stack discovery
// ---------------------------------------------------------------------------

/** One layer of a `gh stack view --json` payload. */
export interface StackLayer {
	branch: string;
	pr?: { number?: number; title?: string; state?: string; url?: string } | null;
}

/**
 * Render the current branch's PR discovery: an optional single PR plus the
 * containing gh-stack layers (when the branch is stacked). Pure — text in,
 * markdown out. `stack` is undefined when the branch isn't in a stack.
 */
export function formatPrDiscovery(branch: string, pr: PrInfo | undefined, stack: StackLayer[] | undefined): string {
	const lines: string[] = [];
	if (pr) {
		const draft = pr.isDraft ? " (draft)" : "";
		lines.push(`# Current PR — #${pr.number} [${pr.state}]${draft}`);
		lines.push(`${pr.title}`);
		lines.push(`${pr.headRefName} → ${pr.baseRefName}`);
		lines.push(pr.url);
	} else {
		lines.push(`# No PR for branch \`${branch}\``);
	}
	if (stack && stack.length > 0) {
		lines.push("", `## Stack (${stack.length} layers, bottom → top)`);
		stack.forEach((layer, i) => {
			const current = layer.branch === branch ? " ← current" : "";
			const prPart =
				layer.pr?.number !== undefined ? `PR #${layer.pr.number} [${layer.pr.state ?? "?"}] ${layer.pr.title ?? ""}` : "no PR";
			lines.push(`${i + 1}. \`${layer.branch}\` — ${prPart}${current}`);
		});
	}
	if (!pr && (!stack || stack.length === 0)) lines.push("Not in a stack either; nothing to track.");
	return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// get_pr_details — combined check-run + comment aggregation
// ---------------------------------------------------------------------------

/** One entry from `gh pr checks --json`. */
export interface PrCheckRun {
	name: string;
	state: string;
	bucket: "pass" | "fail" | "pending" | "skipping" | "cancel" | string;
	link: string;
	workflow: string;
	description: string;
	startedAt: string;
	completedAt: string;
}

/** A passing check: metadata only, no log. */
export interface CheckPass {
	name: string;
	state: string;
	workflow: string;
	description: string;
}

/** A failing check: metadata plus the fetched failure log (empty until filled). */
export interface CheckFail {
	name: string;
	state: string;
	workflow: string;
	description: string;
	link: string;
	log: string;
}

/** Combined PR details payload returned by the get_pr_details tool. */
export interface PrDetails {
	number: number;
	title: string;
	url: string;
	state: string;
	isDraft: boolean;
	headRefName: string;
	baseRefName: string;
	checks: {
		passing: CheckPass[];
		failed: CheckFail[];
		pending: CheckPass[];
		summary: { total: number; passing: number; failed: number; pending: number };
	};
	comments: FlatComment[];
}

/**
 * Split `gh pr checks` output into passing / failed / pending buckets.
 * Failed checks get an empty `log` the caller fills by fetching
 * `gh run view --log-failed`. Pure — no I/O.
 */
export function buildPrDetails(pr: PrInfo, checkRuns: PrCheckRun[], comments: FlatComment[]): PrDetails {
	const passing: CheckPass[] = [];
	const failed: CheckFail[] = [];
	const pending: CheckPass[] = [];
	for (const c of checkRuns) {
		const meta = { name: c.name, state: c.state, workflow: c.workflow, description: c.description };
		if (c.bucket === "pass" || c.bucket === "skipping") {
			passing.push(meta);
		} else if (c.bucket === "fail" || c.bucket === "cancel") {
			failed.push({ ...meta, link: c.link, log: "" });
		} else {
			pending.push(meta);
		}
	}
	return {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		state: pr.state,
		isDraft: pr.isDraft,
		headRefName: pr.headRefName,
		baseRefName: pr.baseRefName,
		checks: {
			passing,
			failed,
			pending,
			summary: { total: checkRuns.length, passing: passing.length, failed: failed.length, pending: pending.length },
		},
		comments,
	};
}
