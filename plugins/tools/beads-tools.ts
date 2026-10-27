/** Beads (bd) task-manager tools: CLI CRUD without loading the beads skill. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTodoCreateArgs, buildTodoUpdateArgs, closeTodoChain, type TodoCreateArgs, type TodoUpdateArgs } from "./beads.ts";
import { runCli } from "./cli.ts";
import { toolText } from "./tool-result.ts";

const TODO_STATUS = ["open", "in_progress", "blocked", "deferred", "closed"] as const;
const TODO_TYPE = ["bug", "task", "feature", "epic", "chore"] as const;

/** Run a bd CLI command; map common failures to actionable messages. */
async function runBd(pi: ExtensionAPI, args: string[]) {
	return runCli(pi, "bd", args, {
		notFound: "bd CLI not found — install with `brew install beads`.",
		mappings: [
			{ pattern: /database not found|no beads database|not initialized/i, message: "beads is not initialized in this repo — run `bd init` (or the setup-repo skill)." },
		],
	});
}

export function registerBeadsTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "add_todo",
		label: "Add Todo",
		description: "Create a task in beads with full metadata. Use real issue IDs in deps.",
		parameters: {
			type: "object",
			properties: {
				title: { type: "string" },
				type: { type: "string", enum: ["bug", "task", "feature", "epic", "chore", "decision"] },
				priority: { type: "integer", minimum: 0, maximum: 4 },
				description: { type: "string" },
				acceptance: { type: "string" },
				design: { type: "string" },
				notes: { type: "string" },
				labels: { type: "array", items: { type: "string" } },
				parent: { type: "string" },
				deps: { type: "array", items: { type: "string" } },
				validate: { type: "boolean" },
			},
			required: ["title"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: TodoCreateArgs) => {
			const r = await runBd(pi, buildTodoCreateArgs(params));
			return toolText(r.text, !r.ok);
		},
	});

	pi.registerTool({
		name: "list_todos",
		label: "List Todos",
		description:
			"List tasks from beads (bd), this repo's persistent task manager. " +
			"With `ready: true`, returns only unblocked, unclaimed work — the recommended way to pick up work. " +
			"Team label convention: `ready-for-agent` = agent-tackleable, `ready-for-human` = waiting on a person.",
		parameters: {
			type: "object",
			properties: {
				status: { type: "string", enum: TODO_STATUS, description: "Filter by status (default: all)" },
				ready: { type: "boolean", description: "Only unblocked, unclaimed work (bd ready)" },
				labels: {
					type: "array",
					items: { type: "string" },
					description: "Only issues having ALL of these labels (default: no label filter)",
				},
				anyLabel: { type: "array", items: { type: "string" }, description: "Only issues having AT LEAST ONE of these labels (OR)" },
			},
			additionalProperties: false,
		},
		approval: "read",
		execute: async (_id, params: { status?: string; ready?: boolean; labels?: string[]; anyLabel?: string[] }) => {
			const args = params.ready ? ["ready", "--json"] : ["list", "--json", ...(params.status ? ["-s", params.status] : [])];
			for (const l of params.labels ?? []) args.push("-l", l);
			for (const l of params.anyLabel ?? []) args.push("--label-any", l);
			const r = await runBd(pi, args);
			return toolText(r.text, !r.ok);
		},
	});

	pi.registerTool({
		name: "read_todo",
		label: "Read Todo",
		description: "Read one beads (bd) issue with full context — description, notes, dependencies.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Issue id, e.g. bd-42" },
				long: { type: "boolean", description: "Include extended metadata (bd show --long)" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		approval: "read",
		execute: async (_id, params: { id: string; long?: boolean }) => {
			const r = await runBd(pi, ["show", params.id, "--json", ...(params.long ? ["--long"] : [])]);
			return toolText(r.text, !r.ok);
		},
	});

	pi.registerTool({
		name: "edit_todo",
		label: "Edit Todo",
		description: "Update a beads issue using exact local IDs.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string" },
				status: { type: "string" },
				claim: { type: "boolean" },
				notes: { type: "string" },
				addLabels: { type: "array", items: { type: "string" } },
				removeLabels: { type: "array", items: { type: "string" } },
				title: { type: "string" },
				description: { type: "string" },
				acceptance: { type: "string" },
				design: { type: "string" },
				priority: { type: "integer" },
				parent: { type: "string" },
				closeReason: { type: "string" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: TodoUpdateArgs & { closeReason?: string }) => {
			if (params.closeReason !== undefined) {
				const r = await runBd(pi, ["close", params.id, "--reason", params.closeReason, "--json"]);
				return toolText(r.text, !r.ok);
			}
			const args = buildTodoUpdateArgs(params);
			if (args.length === 3) return toolText("Nothing to change — pass an update field or closeReason.", true);
			const r = await runBd(pi, args);
			return toolText(r.text, !r.ok);
		},
	});

	pi.registerTool({
		name: "close_todo_chain",
		label: "Close Todo Chain",
		description:
			"Close a beads issue and every transitive downstream issue it blocks. The tool discovers the complete chain and sends one batched bd close command; use this instead of closing chain members manually.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Root issue id, e.g. om-42" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: { id: string }) => {
			const result = await closeTodoChain(params.id, (args) => runBd(pi, args));
			return toolText(result.text, !result.ok);
		},
	});

	pi.registerTool({
		name: "bd_init",
		label: "Init Beads",
		description:
			"Initialize beads (bd) in this repo — creates .beads/ and the Dolt database. The prefix becomes the issue-id prefix (<prefix>-42); derive it from the repo name (short, lowercase) and confirm with the user first. " +
			"On an already-initialized repo: same prefix is a no-op, a different prefix renames all existing issue ids.",
		parameters: {
			type: "object",
			properties: {
				prefix: { type: "string", description: "Issue-id prefix, e.g. 'om' for omp-marketplace (default: current directory name)" },
			},
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: { prefix?: string }) => {
			// Already initialized? Read the current prefix from .beads/metadata.json.
			const metaPath = join(process.cwd(), ".beads", "metadata.json");
			if (existsSync(metaPath)) {
				let current: string | undefined;
				try {
					const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { dolt_database?: unknown };
					if (typeof meta.dolt_database === "string" && meta.dolt_database.length > 0) current = meta.dolt_database;
				} catch {
					// unreadable metadata — fall through to bd init's own error
				}
				if (!params.prefix || params.prefix === current) {
					return toolText(`beads is already initialized here${current ? ` (prefix "${current}")` : ""} — nothing to do.`);
				}
				const r = await runBd(pi, ["rename-prefix", params.prefix]);
				return toolText(r.ok ? `Renamed issue prefix "${current ?? "?"}" → "${params.prefix}": ${r.text}` : r.text, !r.ok);
			}
			const r = await runBd(pi, ["init", ...(params.prefix ? ["--prefix", params.prefix] : [])]);
			return toolText(r.text, !r.ok);
		},
	});

	pi.registerTool({
		name: "todo_reset",
		label: "Reset Todos",
		description:
			"Delete ALL beads (bd) issues in this repo — every status, irreversible. Use when starting a new project on a repo that has stale todos. Requires `confirm: true`.",
		parameters: {
			type: "object",
			properties: {
				confirm: { type: "boolean", description: "Must be true — guards against accidental wipes" },
			},
			required: ["confirm"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: { confirm: boolean }) => {
			if (params.confirm !== true) return toolText("Refused — pass confirm: true to delete ALL todos.", true);
			const list = await runBd(pi, ["list", "-s", "open,in_progress,blocked,deferred,closed", "--json"]);
			if (!list.ok) return toolText(list.text, true);
			let ids: string[] = [];
			try {
				const parsed = JSON.parse(list.text) as Array<{ id?: unknown }>;
				ids = parsed.map((i) => i.id).filter((v): v is string => typeof v === "string");
			} catch {
				return toolText(`Could not parse bd list output: ${list.text.slice(0, 200)}`, true);
			}
			if (ids.length === 0) return toolText("No todos to reset — the tracker is already empty.");
			const r = await runBd(pi, ["delete", ...ids, "--force", "--json"]);
			return toolText(r.ok ? `Reset complete — deleted ${ids.length} todo${ids.length === 1 ? "" : "s"}.` : r.text, !r.ok);
		},
	});

	pi.registerTool({
		name: "del_todo",
		label: "Delete Todo",
		description:
			"Permanently delete a beads (bd) issue and clean up its dependency references. Destructive — prefer closing with a reason.",
		parameters: {
			type: "object",
			properties: {
				id: { type: "string", description: "Issue id, e.g. bd-42" },
			},
			required: ["id"],
			additionalProperties: false,
		},
		approval: "write",
		execute: async (_id, params: { id: string }) => {
			const r = await runBd(pi, ["delete", params.id, "--force", "--json"]);
			return toolText(r.text, !r.ok);
		},
	});
}
