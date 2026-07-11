import { describe, expect, it } from "vitest";
import { buildTitlePrompt, DEFAULT_ENRICH_PROMPT, fillPrompt } from "./prompt";

describe("fillPrompt", () => {
	it("substitutes all placeholders", () => {
		const out = fillPrompt(DEFAULT_ENRICH_PROMPT, {
			title: "Sprint sync",
			date: "2026-07-10",
			attendees: "Ann, Bob",
			notes: "we shipped X",
			transcript: "Ann: hi",
		});
		expect(out).toContain("Meeting: Sprint sync");
		expect(out).toContain("Date: 2026-07-10");
		expect(out).toContain("Attendees: Ann, Bob");
		expect(out).toContain("we shipped X");
		expect(out).toContain("Ann: hi");
		expect(out).not.toContain("{{");
	});

	it("defaults empty fields to (none)", () => {
		const out = fillPrompt("{{notes}}|{{transcript}}", {
			title: "t",
			date: "d",
			attendees: "",
			notes: "",
			transcript: "   ",
		});
		expect(out).toBe("(none)|(none)");
	});
});

describe("buildTitlePrompt", () => {
	it("includes notes and transcript", () => {
		const out = buildTitlePrompt("plan the launch", "we discussed pricing");
		expect(out).toContain("plan the launch");
		expect(out).toContain("we discussed pricing");
		expect(out).toContain("at most 8 words");
	});

	it("falls back to (none) for empty inputs", () => {
		const out = buildTitlePrompt("", "   ");
		expect(out).toContain('"""\n(none)\n"""');
	});
});
