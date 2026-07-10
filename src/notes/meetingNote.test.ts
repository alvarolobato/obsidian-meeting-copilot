import { describe, expect, it } from "vitest";
import { TRANSCRIPT_HEADING, upsertSection } from "./meetingNote";

describe("upsertSection", () => {
	it("appends the section when it is missing", () => {
		const out = upsertSection(
			"# Title\n\n## Notes\n\nfoo\n",
			TRANSCRIPT_HEADING,
			"hello world"
		);
		expect(out).toContain("## Notes\n\nfoo");
		expect(out).toContain("## Transcript\n\nhello world");
		expect(out.trimEnd().endsWith("hello world")).toBe(true);
	});

	it("replaces existing section content, preserving later sections", () => {
		const input =
			"# T\n\n## Transcript\n\nold line\n\n## Action items\n\n- a\n";
		const out = upsertSection(input, TRANSCRIPT_HEADING, "new text");
		expect(out).toContain("## Transcript\n\nnew text");
		expect(out).not.toContain("old line");
		expect(out).toContain("## Action items\n\n- a");
	});

	it("handles empty content", () => {
		expect(upsertSection("", TRANSCRIPT_HEADING, "body")).toBe(
			"## Transcript\n\nbody\n"
		);
	});

	it("keeps multi-paragraph transcript bodies intact", () => {
		const out = upsertSection("# T\n", TRANSCRIPT_HEADING, "para one\n\npara two");
		expect(out).toContain("para one\n\npara two");
	});
});
