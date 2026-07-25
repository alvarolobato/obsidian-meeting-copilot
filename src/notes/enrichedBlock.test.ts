import { describe, expect, it } from "vitest";
import {
	extractSection,
	extractTranscript,
	stripEnriched,
	withEnrichedBlock,
} from "./enrichedBlock";

describe("withEnrichedBlock", () => {
	it("inserts an expanded gray callout after the H1 title", () => {
		const out = withEnrichedBlock("# Meeting\n\n## Notes\n\nmy note\n", "### Summary\n- ok");
		expect(out).toContain("> [!ai-notes]+ AI notes");
		expect(out).toContain("> ### Summary");
		// Title stays first, callout sits above the manual notes.
		expect(out.indexOf("# Meeting")).toBeLessThan(out.indexOf("[!ai-notes]"));
		expect(out.indexOf("[!ai-notes]")).toBeLessThan(out.indexOf("## Notes"));
	});

	it("replaces an existing enriched callout (idempotent)", () => {
		const once = withEnrichedBlock("# M\n\n## Notes\n\nn\n", "old summary");
		const twice = withEnrichedBlock(once, "new summary");
		expect(twice).toContain("> new summary");
		expect(twice).not.toContain("old summary");
		expect(twice.match(/\[!ai-notes\]/g)?.length).toBe(1);
	});

	it("keeps YAML frontmatter at the top", () => {
		const input = "---\ntitle: M\n---\n\n# M\n\n## Notes\n\nn\n";
		const out = withEnrichedBlock(input, "summary");
		expect(out.startsWith("---\ntitle: M\n---\n")).toBe(true);
		expect(out.indexOf("---", 3)).toBeLessThan(out.indexOf("[!ai-notes]"));
	});

	it("keeps empty frontmatter and EOF-closing fences above the callout", () => {
		const empty = withEnrichedBlock("---\n---\n# M\n\nbody\n", "summary");
		expect(empty.startsWith("---\n---\n")).toBe(true);
		expect(empty.indexOf("---", 3)).toBeLessThan(empty.indexOf("[!ai-notes]"));

		const eof = withEnrichedBlock("---\ntitle: M\n---", "summary");
		expect(eof.startsWith("---\ntitle: M\n---")).toBe(true);
		expect(eof.indexOf("[!ai-notes]")).toBeGreaterThan(eof.indexOf("---", 3));
	});
});

describe("stripEnriched", () => {
	it("is a no-op when no enriched block exists", () => {
		const input = "# M\n\n## Notes\n\nn";
		expect(stripEnriched(input)).toBe(input);
	});
});

describe("extractSection", () => {
	it("returns the section body up to the next heading", () => {
		const content = "# M\n\n## Notes\n\nline a\nline b\n\n## Summary\n\nx\n";
		expect(extractSection(content, "## Notes")).toBe("line a\nline b");
	});

	it("returns empty string when the section is absent", () => {
		expect(extractSection("# M\n", "## Notes")).toBe("");
	});

	// #20: the transcript callout has no heading and is pinned at the bottom, so
	// it falls inside the trailing section's extent. extractSection must stop at
	// it, otherwise a caller reading "## Action items" gets the whole transcript.
	it("stops at the trailing transcript callout", () => {
		const content = [
			"# M",
			"",
			"## Action items",
			"",
			"- [ ] a task",
			"",
			"> [!quote]- Transcript",
			"> Ann: hi",
			"> Bob: yo",
			"",
		].join("\n");
		expect(extractSection(content, "## Action items")).toBe("- [ ] a task");
	});
});

describe("extractTranscript", () => {
	it("un-quotes the transcript callout body", () => {
		const content =
			"# M\n\n> [!quote]- Transcript\n> Ann: hi\n>\n> Bob: yo\n";
		expect(extractTranscript(content)).toBe("Ann: hi\n\nBob: yo");
	});

	it("ignores a hand-made Transcript callout of another type", () => {
		const content = [
			"# M",
			"",
			"> [!note] Transcript",
			"> my annotations",
			"",
			"> [!quote]- Transcript",
			"> Ann: hi",
		].join("\n");
		expect(extractTranscript(content)).toBe("Ann: hi");
	});

	it("falls back to a legacy '## Transcript' section", () => {
		const content =
			"# M\n\n## Notes\n\n- a note\n\n## Transcript\n\nAnn: hi\nBob: yo\n";
		expect(extractTranscript(content)).toBe("Ann: hi\nBob: yo");
	});

	it("returns empty string when there is no transcript", () => {
		expect(extractTranscript("# M\n\n## Notes\n\nn")).toBe("");
	});
});
