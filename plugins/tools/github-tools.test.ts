import { describe, expect, it } from "bun:test";
import { parsePrNumber } from "./github-tools.ts";

describe("parsePrNumber", () => {
	it("accepts bare numbers and # refs", () => {
		expect(parsePrNumber("123")).toBe(123);
		expect(parsePrNumber("#42")).toBe(42);
		expect(parsePrNumber(" PR #7 ")).toBe(7);
	});

	it("extracts the trailing PR number from URLs", () => {
		expect(parsePrNumber("https://github.com/aws/aws-sdk-js-v3/pull/1234")).toBe(1234);
		expect(parsePrNumber("github.com/org/repo2/pull/123")).toBe(123);
		expect(parsePrNumber("https://github.com/o/r/pull/7/")).toBe(7);
	});

	it("rejects non-references", () => {
		expect(Number.isFinite(parsePrNumber("main"))).toBe(false);
		expect(Number.isFinite(parsePrNumber(""))).toBe(false);
	});
});
