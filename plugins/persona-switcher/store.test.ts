import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OVERWRITE_MESSAGE, isValidSlug, listPersonas, savePersona } from "./store.ts";

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
