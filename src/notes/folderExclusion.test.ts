import { describe, expect, it } from "vitest";
import { isPathExcluded, parseFolderPatterns } from "./folderExclusion";

describe("parseFolderPatterns", () => {
	it("splits on newlines and commas, trims, and drops empties", () => {
		expect(parseFolderPatterns("Archive\nTemplates, Journal/2020\n\n")).toEqual([
			"Archive",
			"Templates",
			"Journal/2020",
		]);
	});

	it("strips leading/trailing slashes", () => {
		expect(parseFolderPatterns("/Archive/\n**/old/")).toEqual([
			"Archive",
			"**/old",
		]);
	});
});

describe("isPathExcluded", () => {
	it("returns false with no patterns", () => {
		expect(isPathExcluded("Meetings/foo.md", [])).toBe(false);
	});

	it("matches a note's own path exactly", () => {
		expect(isPathExcluded("Templates/base.md", ["Templates/base.md"])).toBe(
			true
		);
	});

	it("a plain folder pattern excludes everything under it, without needing /**", () => {
		expect(
			isPathExcluded("Meetings/ZZZarchived/2026-01-01 foo.md", [
				"Meetings/ZZZarchived",
			])
		).toBe(true);
		expect(
			isPathExcluded("Meetings/ZZZarchived/nested/foo.md", [
				"Meetings/ZZZarchived",
			])
		).toBe(true);
	});

	it("doesn't match a sibling folder with a similar name", () => {
		expect(
			isPathExcluded("Meetings/ZZZarchivedOther/foo.md", [
				"Meetings/ZZZarchived",
			])
		).toBe(false);
	});

	it("doesn't match a folder outside the excluded one", () => {
		expect(isPathExcluded("Meetings/Active/foo.md", ["Meetings/ZZZarchived"])).toBe(
			false
		);
	});

	it("* matches within a single path segment", () => {
		expect(isPathExcluded("Projects/Alpha/old/foo.md", ["Projects/*/old"])).toBe(
			true
		);
		expect(
			isPathExcluded("Projects/Alpha/Sub/old/foo.md", ["Projects/*/old"])
		).toBe(false);
	});

	it("**/name matches that folder name at any depth, including the root", () => {
		const patterns = ["**/archived"];
		expect(isPathExcluded("archived/foo.md", patterns)).toBe(true);
		expect(isPathExcluded("Meetings/archived/foo.md", patterns)).toBe(true);
		expect(isPathExcluded("Meetings/Sub/archived/foo.md", patterns)).toBe(true);
		expect(isPathExcluded("Meetings/notarchived/foo.md", patterns)).toBe(
			false
		);
	});

	it("name/** matches that folder and everything under it (same as the bare form)", () => {
		expect(isPathExcluded("Archive/foo.md", ["Archive/**"])).toBe(true);
		expect(isPathExcluded("Archive/nested/foo.md", ["Archive/**"])).toBe(true);
	});

	it("a bare ** matches everything", () => {
		expect(isPathExcluded("anything/at/all.md", ["**"])).toBe(true);
	});

	it("is case-sensitive, matching the rest of the plugin's own folder checks", () => {
		expect(isPathExcluded("archive/foo.md", ["Archive"])).toBe(false);
	});

	it("matches if any of several patterns hits", () => {
		const patterns = ["Templates", "**/old", "PluginData"];
		expect(isPathExcluded("PluginData/foo/data.json", patterns)).toBe(true);
		expect(isPathExcluded("Meetings/foo.md", patterns)).toBe(false);
	});

	it("treats regex-special characters other than * as literal, not throwing", () => {
		// A leading "?" is a regex quantifier with nothing to repeat — it must
		// not reach RegExp unescaped, or every scan using this pattern throws.
		expect(() => isPathExcluded("Notes/foo.md", ["?Archive"])).not.toThrow();
		expect(isPathExcluded("?Archive/foo.md", ["?Archive"])).toBe(true);
		expect(isPathExcluded("Archive/foo.md", ["?Archive"])).toBe(false);
		// A trailing "?" must not make the preceding character optional.
		expect(isPathExcluded("Archive/foo.md", ["Archive?"])).toBe(false);
		expect(isPathExcluded("Archiv/foo.md", ["Archive?"])).toBe(false);
		// Other regex metacharacters a real folder name could contain.
		expect(isPathExcluded("Q&A (2026)/foo.md", ["Q&A (2026)"])).toBe(true);
		expect(isPathExcluded("C++ notes/foo.md", ["C++ notes"])).toBe(true);
	});
});
