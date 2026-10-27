/** /persona command wiring over the persona library in store.ts. */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { activePersonaName, activatePersona, deactivatePersona, listPersonas, readPersona, removePersona, savePersona } from "./store.ts";

type PersonaList = {
	active: string;
	names: string[];
};
type PersonaChoice = {
	label: string;
	description: string;
	args: string;
	confirm?: string;
};

function pickerChoices(agentDir: string): PersonaChoice[] {
	const names = listPersonas(agentDir);
	return [
		{ label: "list — show saved personas", description: "Show saved personas and active persona", args: "list" },
		{ label: "current — show active persona name", description: "Show active persona name", args: "current" },
		...names.map((name) => ({
			label: `use ${name}`,
			description: "Use persona in the next OMP session",
			args: `use ${name}`,
		})),
		{ label: "off — deactivate active persona", description: "Deactivate active persona", args: "off" },
		...names.map((name) => ({
			label: `show ${name}`,
			description: "View persona instructions",
			args: `show ${name}`,
		})),
		...names.map((name) => ({
			label: `remove ${name}`,
			description: "Delete saved persona",
			args: `remove ${name}`,
			confirm: `Remove saved persona "${name}"?`,
		})),
	];
}

export function argumentCompletions(agentDir: string, args: string): Array<{ value: string; label: string; description: string }> {
	const [command = "", slug] = args.split(/\s+/);
	if (slug === undefined) {
		return ["list", "current", "use", "off", "show", "remove", "generate"]
			.filter((name) => name.startsWith(command.toLowerCase()))
			.map((name) => ({ value: `${name} `, label: name, description: "" }));
	}
	if (command !== "use" && command !== "show" && command !== "remove") return [];
	const prefix = args.slice(args.indexOf(" ") + 1);
	return listPersonas(agentDir)
		.filter((name) => name.startsWith(prefix.toLowerCase()))
		.map((name) => ({
			value: `${command} ${name}`,
			label: name,
			description: "",
		}));
}

function selectedPickerArgs(choices: PersonaChoice[], selected: unknown): string | undefined {
	const label = typeof selected === "string" ? selected : (selected as { label?: string } | undefined)?.label;
	return choices.find(({ label: choice }) => choice === label)?.args;
}

function renderList(agentDir: string): PersonaList {
	return {
		active: activePersonaName(agentDir) ?? "none",
		names: listPersonas(agentDir),
	};
}

function formatList({ active, names }: PersonaList): string {
	const items = names.length === 0 ? "(empty)" : names.map((name) => `${name === active ? "*" : "-"} ${name}`).join("\n");
	return `Active: ${active}\n\nLibrary:\n${items}`;
}

function usage(): string {
	return [
		"Usage: /persona [list|current|use <slug>|off|show <slug>|remove <slug> --confirm|generate <brief>]",
		"generate hands the brief to the agent, which authors the persona via the persona-generator skill and saves it with persona_create.",
		"Personas take effect in a new OMP session.",
	].join("\n");
}

async function showText(ctx: ExtensionContext, title: string, text: string, active?: string): Promise<void> {
	if (!ctx.hasUI) {
		console.log(text);
		return;
	}
	await ctx.ui.custom<void>(async (_tui, theme, keybindings, done) => {
		// Lazy UI-only import keeps headless/source-tree command tests dependency-free.
		const { replaceTabs, truncateToWidth } = await import("@oh-my-pi/pi-tui");
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			done(undefined);
		};
		return {
			render(width: number): readonly string[] {
				const activeLine = active === undefined ? undefined : `* ${active}`;
				return [
					theme.fg("accent", title),
					"",
					...text.split("\n").map((line) => line === activeLine ? theme.fg("accent", line) : line),
					"",
					theme.fg("muted", "Press Esc to close"),
				].map((line) => truncateToWidth(replaceTabs(line), width));
			},
			handleInput(data: string): void {
				if (keybindings.matches(data, "app.interrupt")) finish();
			},
		};
	}, { overlay: true });
}

async function notify(ctx: ExtensionContext, text: string, level: "info" | "error" = "info"): Promise<void> {
	if (ctx.hasUI && typeof ctx.ui?.notify === "function") {
		ctx.ui.notify(text, level);
		return;
	}
	console.log(text);
}

export default function personaSwitcher(pi: ExtensionAPI): void {
	const { settings } = pi.pi;

	pi.registerTool({
		name: "persona_create",
		label: "Persona Create",
		description:
			"Generate and save a new persona matrix. Load the persona-generator skill first for authoring guidance, " +
			"then pass the finished raw Markdown here. Refuses to overwrite an existing persona.",
		parameters: {
			type: "object",
			properties: {
				slug: { type: "string", minLength: 1 },
				content: { type: "string", minLength: 1 },
			},
			required: ["slug", "content"],
			additionalProperties: false,
		},
		approval: "write",
		async execute(_toolCallId, params: { slug: string; content: string }) {
			try {
				savePersona(settings.getAgentDir(), params.slug, params.content);
				return {
					content: [{ type: "text", text: `Saved persona ${params.slug}. Activate with /persona use ${params.slug}; it takes effect in a new OMP session.` }],
					details: { slug: params.slug },
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
					details: { slug: params.slug },
					isError: true,
				};
			}
		},
	});

	pi.registerCommand("persona", {
		description: "List, activate, inspect, deactivate, or remove saved OMP personas.",
		getArgumentCompletions: (args: string) => argumentCompletions(settings.getAgentDir(), args),
		handler: async (rawArgs, ctx) => {
			const agentDir = settings.getAgentDir();
			let args = rawArgs.trim();
			if (args.length === 0 && ctx.hasUI && typeof ctx.ui?.select === "function") {
				const choices = pickerChoices(agentDir);
				const selected = await ctx.ui.select("OMP personas", choices.map(({ label, description }) => ({ label, description })));
				const chosenArgs = selectedPickerArgs(choices, selected);
				if (chosenArgs === undefined) return;
				const choice = choices.find((entry) => entry.args === chosenArgs);
				if (choice?.confirm !== undefined) {
					const proceed = ctx.ui.confirm === undefined || await ctx.ui.confirm("Confirm removal", choice.confirm);
					if (!proceed) return;
					args = `${chosenArgs} --confirm`;
				} else {
					args = chosenArgs;
				}
			}
			const [rawCommand = "list", slug, confirmation] = args.split(/\s+/);
			const command = rawCommand === "" ? "list" : rawCommand;
			try {
				switch (command) {
					case "list": {
						const list = renderList(agentDir);
						await showText(ctx, "OMP personas", formatList(list), list.active === "none" ? undefined : list.active);
						return;
					}
					case "current":
						await notify(ctx, activePersonaName(agentDir) ?? "No persona active (none)");
						return;
					case "use":
						if (slug === undefined) throw new Error("Specify a persona slug: /persona use <slug>");
						activatePersona(agentDir, slug);
						await notify(ctx, `Activated ${slug}. Start a new OMP session for it to take effect.`);
						return;
					case "generate": {
						const brief = args.slice(command.length).trim();
						if (!brief) throw new Error("Describe the persona: /persona generate <brief>");
						pi.sendUserMessage(
							`Create a new OMP persona. Follow the persona-generator skill for scope, research, and matrix format, then save it with the persona_create tool. Brief: ${brief}`,
						);
						await notify(ctx, "Persona generation queued. The agent will research, draft, and save it; activate later with /persona use <slug>.");
						return;
					}
					case "off": {
						const active = activePersonaName(agentDir);
						if (!deactivatePersona(agentDir)) throw new Error("No persona-switcher persona is active.");
						await notify(ctx, `Deactivated ${active}.`);
						return;
					}
					case "show":
						if (slug === undefined) throw new Error("Specify a persona slug: /persona show <slug>");
						await showText(ctx, `Persona: ${slug}`, readPersona(agentDir, slug));
						return;
					case "remove":
						if (slug === undefined) throw new Error("Specify a persona slug: /persona remove <slug> --confirm");
						if (confirmation !== "--confirm") throw new Error("Removal requires --confirm.");
						removePersona(agentDir, slug);
						await notify(ctx, `Removed ${slug}.`);
						return;
					default:
						await showText(ctx, "Persona commands", usage());
				}
			} catch (error) {
				await notify(ctx, `Persona command failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
