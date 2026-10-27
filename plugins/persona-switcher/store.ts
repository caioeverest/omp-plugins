/** Persona library on the agent dir: PERSONALITY.md slot plus a personas/ folder. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PERSONA_MARKER = "<!-- omp-persona: ";
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function slotPath(agentDir: string): string {
	return join(agentDir, "PERSONALITY.md");
}

export function isValidSlug(slug: string): boolean {
	return SLUG_PATTERN.test(slug);
}

function personaPath(agentDir: string, slug: string): string {
	if (!isValidSlug(slug)) throw new Error("Persona names use lowercase letters, digits, and interior hyphens only.");
	return join(agentDir, "personas", `${slug}.md`);
}

export function activePersonaName(agentDir: string): string | undefined {
	const slot = slotPath(agentDir);
	if (!existsSync(slot)) return undefined;
	const firstLine = readFileSync(slot, "utf8").split("\n", 1)[0] ?? "";
	if (!firstLine.startsWith(PERSONA_MARKER) || !firstLine.endsWith(" -->")) return undefined;
	const slug = firstLine.slice(PERSONA_MARKER.length, -4);
	return isValidSlug(slug) ? slug : undefined;
}

export function listPersonas(agentDir: string): string[] {
	const library = join(agentDir, "personas");
	if (!existsSync(library)) return [];
	return readdirSync(library, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name.slice(0, -3))
		.filter(isValidSlug)
		.sort((left, right) => left.localeCompare(right));
}

function writeAtomically(path: string, content: string): void {
	const temporary = `${path}.tmp.${process.pid}`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, path);
}

export function activatePersona(agentDir: string, slug: string): void {
	const source = personaPath(agentDir, slug);
	if (!existsSync(source)) throw new Error(`Persona not found: ${slug}`);
	mkdirSync(agentDir, { recursive: true });

	const slot = slotPath(agentDir);
	const backup = join(agentDir, "PERSONALITY.md.persona-switcher-backup");
	if (existsSync(slot) && activePersonaName(agentDir) === undefined) {
		if (existsSync(backup)) throw new Error(`Backup already exists at ${backup}; restore or remove it before switching.`);
		copyFileSync(slot, backup);
	}

	const persona = readFileSync(source, "utf8");
	writeAtomically(slot, `${PERSONA_MARKER}${slug} -->\n${persona}`);
}

export function deactivatePersona(agentDir: string): boolean {
	const active = activePersonaName(agentDir);
	if (active === undefined) return false;
	const slot = slotPath(agentDir);
	const backup = join(agentDir, "PERSONALITY.md.persona-switcher-backup");
	rmSync(slot);
	if (existsSync(backup)) renameSync(backup, slot);
	return true;
}

export function removePersona(agentDir: string, slug: string): void {
	if (activePersonaName(agentDir) === slug) throw new Error(`Deactivate ${slug} before removing it.`);
	const source = personaPath(agentDir, slug);
	if (!existsSync(source)) throw new Error(`Persona not found: ${slug}`);
	rmSync(source);
}

export function readPersona(agentDir: string, slug: string): string {
	return readFileSync(personaPath(agentDir, slug), "utf8");
}

export const OVERWRITE_MESSAGE = "already exists; remove it first or pick another slug.";

export function savePersona(agentDir: string, slug: string, content: string): void {
	const target = personaPath(agentDir, slug);
	mkdirSync(join(agentDir, "personas"), { recursive: true });
	if (existsSync(target)) throw new Error(`Persona ${OVERWRITE_MESSAGE}`);
	writeAtomically(target, content);
}
