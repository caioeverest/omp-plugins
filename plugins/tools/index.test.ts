import { describe, expect, it } from "bun:test";
import { compareVersions, parseInstalledMarketplacePluginNames, specPackageName } from "./index.ts";

describe("specPackageName", () => {
	it("maps npm specs to registry names", () => {
		expect(specPackageName("@hypabolic/pi-hypa")).toBe("@hypabolic/pi-hypa");
		expect(specPackageName("npm:pi-rtk-optimizer")).toBe("pi-rtk-optimizer");
		expect(specPackageName("npm:@dietrichgebert/ponytail")).toBe("@dietrichgebert/ponytail");
		expect(specPackageName("left-pad")).toBe("left-pad");
	});
	it("maps git specs to their basename", () => {
		expect(specPackageName("git:github.com/jonjonrankin/pi-caveman")).toBe("pi-caveman");
		expect(specPackageName("github.com/o/r")).toBe("r");
	});
	it("strips pinned versions and commit refs", () => {
		expect(specPackageName("@hypabolic/pi-hypa@1.2.0")).toBe("@hypabolic/pi-hypa");
		expect(specPackageName("npm:pi-rtk-optimizer@0.9.0")).toBe("pi-rtk-optimizer");
		expect(specPackageName("git:github.com/jonjonrankin/pi-caveman@bd0cc77fa74379de1c287e6dc0033d9b16a3a4dc")).toBe("pi-caveman");
		expect(specPackageName("npm:@dietrichgebert/ponytail@5.3.2")).toBe("@dietrichgebert/ponytail");
	});
});

describe("compareVersions", () => {
	it("compares numeric dotted versions", () => {
		expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
		expect(compareVersions("0.2.0", "0.10.0")).toBeLessThan(0);
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
	});
});

describe("parseInstalledMarketplacePluginNames", () => {
	const sample = JSON.stringify({
		npm: [],
		marketplace: [
			{ id: "frontend-design@claude-plugins-official", entries: [] },
			{ id: "frontend-design@omp-everest", entries: [] },
			{ id: "tools@omp-everest", entries: [] },
			{ id: "telegram@omp-everest", entries: [] },
		],
	});
	it("collects plugin names for both marketplace id forms", () => {
		expect(parseInstalledMarketplacePluginNames(sample, "everest")?.sort()).toEqual(["frontend-design", "telegram", "tools"]);
	});
	it("matches the plain suffix form", () => {
		expect(parseInstalledMarketplacePluginNames(sample, "claude-plugins-official")).toEqual(["frontend-design"]);
	});
	it("returns undefined for unparseable output", () => {
		expect(parseInstalledMarketplacePluginNames("not json", "everest")).toBeUndefined();
	});
});
