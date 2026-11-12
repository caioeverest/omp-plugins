import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	activePersonaName,
	activatePersona,
	deactivatePersona,
	OVERWRITE_MESSAGE,
	isValidSlug,
	listPersonas,
	removePersona,
	savePersona,
} from "./store.ts";

let agentDir: string;


beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "persona-test-"));
});

afterEach(() => {
	if (agentDir) rmSync(agentDir, { recursive: true, force: true });
});

describe("savePersona", () => {
	it("writes a listed persona file", () => {
		savePersona(agentDir, "kobeni", "# Persona: Kobeni\n");
		expect(listPersonas(agentDir)).toEqual(["kobeni"]);
		expect(readFileSync(join(agentDir, "personas", "kobeni.md"), "utf8")).toContain("Kobeni");
	});

	it("refuses to overwrite and keeps the original", () => {
		savePersona(agentDir, "kobeni", "# Persona: Kobeni\n");
		expect(() => savePersona(agentDir, "kobeni", "# Replaced\n")).toThrow(OVERWRITE_MESSAGE);
		expect(readFileSync(join(agentDir, "personas", "kobeni.md"), "utf8")).toContain("Kobeni");
	});

	it("rejects invalid slugs without writing", () => {
		expect(() => savePersona(agentDir, "../escape", "# x\n")).toThrow(/lowercase letters/);
		expect(existsSync(join(agentDir, "escape.md"))).toBe(false);
	});

	it("keeps slug validation aligned with the store pattern", () => {
		expect(isValidSlug("kobeni-higashiyama")).toBe(true);
		expect(isValidSlug("-leading")).toBe(false);
		expect(isValidSlug("Trailing-")).toBe(false);
		expect(isValidSlug("has space")).toBe(false);
	});
});

describe("activatePersona / deactivatePersona", () => {
	it("backs up the existing slot and restores it on off", () => {
		savePersona(agentDir, "kobeni", "# Persona: Kobeni\n");
		writeFileSync(join(agentDir, "PERSONALITY.md"), "# My own personality\n");
		activatePersona(agentDir, "kobeni");
		expect(readFileSync(join(agentDir, "PERSONALITY.md"), "utf8").startsWith("<!-- omp-persona: kobeni -->")).toBe(true);
		expect(activePersonaName(agentDir)).toBe("kobeni");
		expect(deactivatePersona(agentDir)).toBe(true);
		expect(readFileSync(join(agentDir, "PERSONALITY.md"), "utf8")).toBe("# My own personality\n");
		expect(existsSync(join(agentDir, "PERSONALITY.md.persona-switcher-backup"))).toBe(false);
	});

	it("switches personas without clobbering the original backup", () => {
		savePersona(agentDir, "a", "# A\n");
		savePersona(agentDir, "b", "# B\n");
		writeFileSync(join(agentDir, "PERSONALITY.md"), "# Original\n");
		activatePersona(agentDir, "a");
		activatePersona(agentDir, "b");
		expect(activePersonaName(agentDir)).toBe("b");
		expect(deactivatePersona(agentDir)).toBe(true);
		expect(readFileSync(join(agentDir, "PERSONALITY.md"), "utf8")).toBe("# Original\n");
	});

	it("refuses to switch while a stale backup exists and the slot is user-owned", () => {
		savePersona(agentDir, "a", "# A\n");
		writeFileSync(join(agentDir, "PERSONALITY.md"), "# User file\n");
		writeFileSync(join(agentDir, "PERSONALITY.md.persona-switcher-backup"), "# Old backup\n");
		expect(() => activatePersona(agentDir, "a")).toThrow(/Backup already exists/);
		expect(readFileSync(join(agentDir, "PERSONALITY.md"), "utf8")).toBe("# User file\n");
	});

	it("restores a stranded backup when the slot is gone", () => {
		writeFileSync(join(agentDir, "PERSONALITY.md.persona-switcher-backup"), "# Saved\n");
		expect(deactivatePersona(agentDir)).toBe(true);
		expect(readFileSync(join(agentDir, "PERSONALITY.md"), "utf8")).toBe("# Saved\n");
	});

	it("returns false when nothing is active and no backup exists", () => {
		expect(deactivatePersona(agentDir)).toBe(false);
	});

	it("refuses to remove the active persona", () => {
		savePersona(agentDir, "kobeni", "# K\n");
		activatePersona(agentDir, "kobeni");
		expect(() => removePersona(agentDir, "kobeni")).toThrow(/Deactivate/);
		expect(existsSync(join(agentDir, "personas", "kobeni.md"))).toBe(true);
	});
});
