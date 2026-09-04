import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
	it("returns undefined without a leading fence", () => {
		expect(parseFrontmatter("# Title\n\n- [ ] task")).toBeUndefined();
		expect(parseFrontmatter("\n---\ntitle: x\n---\n")).toBeUndefined();
	});

	it("returns undefined when the block is never closed", () => {
		expect(parseFrontmatter("---\ntitle: x\n\n# body")).toBeUndefined();
	});

	it("reads the identity fields the dashboard groups on", () => {
		const fm = parseFrontmatter(
			[
				"---",
				"title: Lets get the conversations started",
				"date: 2026-07-27",
				"start: 2026-07-27T13:30:00",
				"one_on_one_with: Ruflin",
				"one_on_one_email: ruflin@elastic.co",
				"recurring_event_id: abc123",
				"---",
				"",
				"- [ ] task",
			].join("\n")
		);
		expect(fm).toMatchObject({
			title: "Lets get the conversations started",
			date: "2026-07-27",
			start: "2026-07-27T13:30:00",
			one_on_one_with: "Ruflin",
			one_on_one_email: "ruflin@elastic.co",
			recurring_event_id: "abc123",
		});
	});

	it("parses indented list values and leaves an empty key null", () => {
		const fm = parseFrontmatter(
			[
				"---",
				"attendees:",
				"  - ruflin@elastic.co",
				"  - alvaro.lobato@elastic.co",
				"recording:",
				"summary: after the list",
				"---",
			].join("\n")
		);
		expect(fm?.["attendees"]).toEqual([
			"ruflin@elastic.co",
			"alvaro.lobato@elastic.co",
		]);
		expect(fm?.["recording"]).toBeNull();
		expect(fm?.["summary"]).toBe("after the list");
	});

	it("coerces booleans, integers and quoted scalars", () => {
		const fm = parseFrontmatter(
			[
				"---",
				"transcript_saved: true",
				"enrich_transcript_truncated: false",
				"take: 2",
				'title: "A: colon in a quoted title"',
				"empty:",
				"---",
			].join("\n")
		);
		expect(fm).toMatchObject({
			transcript_saved: true,
			enrich_transcript_truncated: false,
			take: 2,
			title: "A: colon in a quoted title",
			empty: null,
		});
	});

	it("ignores nested maps rather than half-parsing them", () => {
		const fm = parseFrontmatter(
			["---", "nested:", "  inner: 1", "top: keep", "---"].join("\n")
		);
		expect(fm?.["nested"]).toBeNull();
		expect(fm?.["inner"]).toBeUndefined();
		expect(fm?.["top"]).toBe("keep");
	});
});
