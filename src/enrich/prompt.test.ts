import { describe, expect, it } from "vitest";
import {
	buildTitlePrompt,
	DEFAULT_ENRICH_PROMPT,
	fillPrompt,
	upgradeEnrichPrompt,
} from "./prompt";
import { LEGACY_ENRICH_PROMPTS } from "./legacyEnrichPrompts";

describe("fillPrompt", () => {
	it("substitutes all placeholders", () => {
		const out = fillPrompt(DEFAULT_ENRICH_PROMPT, {
			title: "Sprint sync",
			date: "2026-07-10",
			attendees: "Ann, Bob",
			notes: "we shipped X",
			actionItems: "- Follow up with Bob",
			transcript: "Ann: hi",
		});
		expect(out).toContain("Meeting: Sprint sync");
		expect(out).toContain("Date: 2026-07-10");
		expect(out).toContain("Attendees: Ann, Bob");
		expect(out).toContain("we shipped X");
		expect(out).toContain("- Follow up with Bob");
		expect(out).toContain("Ann: hi");
		expect(out).not.toContain("{{");
	});

	it("substitutes the action-items placeholder", () => {
		const out = fillPrompt("{{actionItems}}", {
			title: "t",
			date: "d",
			attendees: "",
			notes: "",
			actionItems: "- Ship the release",
			transcript: "",
		});
		expect(out).toBe("- Ship the release");
	});

	it("defaults empty fields to (none)", () => {
		const out = fillPrompt("{{notes}}|{{actionItems}}|{{transcript}}", {
			title: "t",
			date: "d",
			attendees: "",
			notes: "",
			actionItems: "",
			transcript: "   ",
		});
		expect(out).toBe("(none)|(none)|(none)");
	});
});

describe("upgradeEnrichPrompt", () => {
	it("upgrades an empty prompt to the current default", () => {
		expect(upgradeEnrichPrompt("")).toBe(DEFAULT_ENRICH_PROMPT);
		expect(upgradeEnrichPrompt("   ")).toBe(DEFAULT_ENRICH_PROMPT);
		expect(upgradeEnrichPrompt(null)).toBe(DEFAULT_ENRICH_PROMPT);
		expect(upgradeEnrichPrompt(undefined)).toBe(DEFAULT_ENRICH_PROMPT);
	});

	it("upgrades a previously shipped default to the current default", () => {
		expect(LEGACY_ENRICH_PROMPTS.length).toBeGreaterThan(0);
		for (const legacy of LEGACY_ENRICH_PROMPTS) {
			expect(upgradeEnrichPrompt(legacy)).toBe(DEFAULT_ENRICH_PROMPT);
		}
	});

	it("returns the current default unchanged", () => {
		expect(upgradeEnrichPrompt(DEFAULT_ENRICH_PROMPT)).toBe(
			DEFAULT_ENRICH_PROMPT
		);
	});

	it("leaves a customized prompt untouched", () => {
		const custom = "My own prompt with {{notes}} and {{transcript}}.";
		expect(upgradeEnrichPrompt(custom)).toBe(custom);
	});

	it("recognizes the legacy default as pre-actionItems", () => {
		// Guards against a mis-copied legacy constant: the outgoing default must
		// genuinely lack the placeholder the current default introduces.
		for (const legacy of LEGACY_ENRICH_PROMPTS) {
			expect(legacy).not.toContain("{{actionItems}}");
		}
		expect(DEFAULT_ENRICH_PROMPT).toContain("{{actionItems}}");
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
