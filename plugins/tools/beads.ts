export interface TodoCreateArgs {
	title: string;
	type?: string;
	priority?: number;
	description?: string;
	acceptance?: string;
	design?: string;
	notes?: string;
	labels?: string[];
	parent?: string;
	deps?: string[];
	validate?: boolean;
}

export function buildTodoCreateArgs(params: TodoCreateArgs): string[] {
	const args = ["create", params.title, "-t", params.type ?? "task", "-p", String(params.priority ?? 2)];
	if (params.description !== undefined) args.push("-d", params.description);
	if (params.acceptance !== undefined) args.push("--acceptance", params.acceptance);
	if (params.design !== undefined) args.push("--design", params.design);
	if (params.notes !== undefined) args.push("--notes", params.notes);
	if (params.labels?.length) args.push("--labels", params.labels.join(","));
	if (params.parent !== undefined) args.push("--parent", params.parent);
	if (params.deps?.length) args.push("--deps", params.deps.join(","));
	if (params.validate) args.push("--validate");
	args.push("--json");
	return args;
}

export interface TodoUpdateArgs {
	id: string;
	status?: string;
	claim?: boolean;
	notes?: string;
	addLabels?: string[];
	removeLabels?: string[];
	title?: string;
	description?: string;
	acceptance?: string;
	design?: string;
	priority?: number;
	parent?: string;
}

export function buildTodoUpdateArgs(params: TodoUpdateArgs): string[] {
	const args = ["update", params.id];
	if (params.status) args.push("-s", params.status);
	if (params.claim) args.push("--claim");
	if (params.notes !== undefined) args.push("--append-notes", params.notes);
	if (params.addLabels?.length) args.push("--add-label", params.addLabels.join(","));
	if (params.removeLabels?.length) args.push("--remove-label", params.removeLabels.join(","));
	if (params.title !== undefined) args.push("--title", params.title);
	if (params.description !== undefined) args.push("-d", params.description);
	if (params.acceptance !== undefined) args.push("--acceptance", params.acceptance);
	if (params.design !== undefined) args.push("--design", params.design);
	if (params.priority !== undefined) args.push("-p", String(params.priority));
	if (params.parent !== undefined) args.push("--parent", params.parent);
	args.push("--json");
	return args;
}

export function buildTodoDependencyArgs(issueId: string, dependsOnId: string, type = "blocks"): string[] {
	return ["dep", "add", issueId, dependsOnId, "--type", type, "--json"];
}
export function buildTodoCloseArgs(issueIds: string[], reason: string): string[] {
	return ["close", ...issueIds, "--reason", reason, "--json"];
}

export interface TodoChainIssue {
	id: string;
	status: string;
	dependents?: Array<{ id?: unknown; dependency_type?: unknown }>;
}

export interface TodoCommandResult {
	ok: boolean;
	text: string;
}

function parseTodoChainIssue(text: string): TodoChainIssue | undefined {
	try {
		const parsed: unknown = JSON.parse(text);
		const value = Array.isArray(parsed) ? parsed[0] : parsed;
		if (typeof value !== "object" || value === null || Array.isArray(value)) return;
		const issue = value as { id?: unknown; status?: unknown; dependents?: unknown };
		if (typeof issue.id !== "string" || typeof issue.status !== "string") return;
		const dependents = Array.isArray(issue.dependents)
			? issue.dependents.filter(
					(dependent): dependent is { id?: unknown; dependency_type?: unknown } =>
						typeof dependent === "object" && dependent !== null,
				)
			: undefined;
		return { id: issue.id, status: issue.status, dependents };
	} catch {
		return;
	}
}

/** Discover and close root plus every transitive downstream `blocks` dependent in one bd command. */
export async function closeTodoChain(rootId: string, run: (args: string[]) => Promise<TodoCommandResult>): Promise<TodoCommandResult> {
	const root = rootId.trim();
	if (!root) return { ok: false, text: "Issue id is required." };

	const queue = [root];
	const seen = new Set<string>();
	const issues: TodoChainIssue[] = [];
	while (queue.length > 0) {
		const id = queue.shift();
		if (id === undefined || seen.has(id)) continue;
		seen.add(id);
		const shown = await run(["show", id, "--json", "--include-dependents"]);
		if (!shown.ok) return shown;
		const issue = parseTodoChainIssue(shown.text);
		if (!issue || issue.id !== id) return { ok: false, text: "bd show returned invalid issue JSON." };
		issues.push(issue);
		const dependents = (issue.dependents ?? [])
			.filter((dependent) => dependent.dependency_type === "blocks" && typeof dependent.id === "string")
			.map((dependent) => dependent.id as string)
			.sort();
		queue.push(...dependents);
	}

	const openIds = issues
		.filter((issue) => issue.status !== "closed")
		.map((issue) => issue.id)
		.sort();
	if (openIds.length === 0) {
		return { ok: true, text: JSON.stringify({ closed: [], skipped: issues.map((issue) => issue.id).sort() }) };
	}
	return run(buildTodoCloseArgs(openIds, `Closed as part of task chain rooted at ${root}`));
}
