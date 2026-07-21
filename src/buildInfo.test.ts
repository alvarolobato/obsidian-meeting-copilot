import { describe, expect, it } from "vitest";
import { describeVersion, type BuildInfo } from "./buildInfo";

const RELEASE: BuildInfo = {
	commit: "a1b2c3d",
	branch: "HEAD",
	buildDate: "2026-07-21",
	isRelease: true,
};

const CUSTOM: BuildInfo = {
	commit: "a1b2c3d",
	branch: "feat/x",
	buildDate: "2026-07-21",
	isRelease: false,
};

describe("describeVersion", () => {
	it("shows just the version for a release build", () => {
		expect(describeVersion("0.4.3", "custom build", RELEASE)).toBe("0.4.3");
	});

	it("appends provenance for a custom build", () => {
		expect(describeVersion("0.4.3", "custom build", CUSTOM)).toBe(
			"0.4.3 (custom build: feat/x · a1b2c3d · 2026-07-21)"
		);
	});

	it("omits a detached HEAD branch", () => {
		expect(
			describeVersion("0.4.3", "custom build", { ...CUSTOM, branch: "HEAD" })
		).toBe("0.4.3 (custom build: a1b2c3d · 2026-07-21)");
	});

	it("degrades to a bare marker when no provenance is available", () => {
		expect(
			describeVersion("0.4.3", "custom build", {
				commit: null,
				branch: null,
				buildDate: null,
				isRelease: false,
			})
		).toBe("0.4.3 (custom build)");
	});

	it("ignores provenance for a release even when fields are present", () => {
		expect(
			describeVersion("0.4.3", "custom build", {
				commit: "a1b2c3d",
				branch: "feat/x",
				buildDate: "2026-07-21",
				isRelease: true,
			})
		).toBe("0.4.3");
	});

	it("handles a commit-only custom build (no branch, no date)", () => {
		expect(
			describeVersion("0.4.3", "custom build", {
				commit: "a1b2c3d",
				branch: null,
				buildDate: null,
				isRelease: false,
			})
		).toBe("0.4.3 (custom build: a1b2c3d)");
	});

	it("uses the provided (localisable) custom-build label", () => {
		expect(
			describeVersion("0.4.3", "compilación personalizada", {
				...CUSTOM,
				branch: "HEAD",
				buildDate: null,
			})
		).toBe("0.4.3 (compilación personalizada: a1b2c3d)");
	});
});
