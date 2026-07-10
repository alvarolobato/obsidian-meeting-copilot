import { describe, expect, it } from "vitest";
import {
	formatTranscriptCallout,
	stripTranscript,
	transcriptAtBottom,
	upsertSection,
} from "./meetingNote";

describe("upsertSection", () => {
	it("appends the section when it is missing", () => {
		const out = upsertSection("# Title\n\n## Notes\n\nfoo\n", "## Summary", "hello world");
		expect(out).toContain("## Notes\n\nfoo");
		expect(out).toContain("## Summary\n\nhello world");
	});

	it("replaces existing section content, preserving later sections", () => {
		const input = "# T\n\n## Summary\n\nold line\n\n## Action items\n\n- a\n";
		const out = upsertSection(input, "## Summary", "new text");
		expect(out).toContain("## Summary\n\nnew text");
		expect(out).not.toContain("old line");
		expect(out).toContain("## Action items\n\n- a");
	});

	it("handles empty content", () => {
		expect(upsertSection("", "## Summary", "body")).toBe("## Summary\n\nbody\n");
	});
});

describe("formatTranscriptCallout", () => {
	it("uses a collapsed callout and quotes every line", () => {
		const out = formatTranscriptCallout("line one\n\nline two");
		expect(out).toBe("> [!quote]- Transcript\n> line one\n>\n> line two");
	});
});

describe("transcriptAtBottom", () => {
	it("appends the transcript below existing sections", () => {
		const out = transcriptAtBottom("# T\n\n## Notes\n\nmy note\n", "hello");
		expect(out).toContain("## Notes\n\nmy note");
		expect(out.trimEnd().endsWith("> hello")).toBe(true);
		expect(out).toContain("> [!quote]- Transcript");
	});

	it("replaces an existing transcript callout and keeps it at the bottom", () => {
		const first = transcriptAtBottom("# T\n\n## Summary\n\ns\n", "old transcript");
		const second = transcriptAtBottom(first, "new transcript");
		expect(second).toContain("> new transcript");
		expect(second).not.toContain("old transcript");
		// Only one transcript callout remains.
		expect(second.match(/\[!quote\]- Transcript/g)?.length).toBe(1);
		// Summary stays above the transcript.
		expect(second.indexOf("## Summary")).toBeLessThan(second.indexOf("[!quote]"));
	});

	it("migrates a legacy '## Transcript' heading section to a bottom callout", () => {
		const legacy = "# T\n\n## Transcript\n\nold body\n\n## Action items\n\n- a\n";
		const out = transcriptAtBottom(legacy, "fresh");
		expect(out).not.toContain("## Transcript");
		expect(out).not.toContain("old body");
		expect(out).toContain("## Action items\n\n- a");
		expect(out.trimEnd().endsWith("> fresh")).toBe(true);
	});
});

describe("stripTranscript", () => {
	it("returns content unchanged when there is no transcript", () => {
		const input = "# T\n\n## Notes\n\nfoo";
		expect(stripTranscript(input)).toBe(input);
	});
});
