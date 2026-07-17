import { describe, expect, it } from "vitest";
import {
	extractActionItems,
	extractManualActionItems,
	refreshActionItems,
} from "./actionItems";

describe("extractActionItems", () => {
	it("converts a Next steps section into task lines and strips it", () => {
		const md = [
			"### Topic",
			"- discussed a thing",
			"",
			"### Next steps",
			"- **Schedule 1:1 with Kate** (Alvaro)",
			"  - she is new to the project",
			"- Align on the entity model (Luca)",
		].join("\n");
		const { items, without } = extractActionItems(md);
		expect(items).toEqual([
			"- [ ] **Schedule 1:1 with Kate** (Alvaro)",
			"- [ ] Align on the entity model (Luca)",
		]);
		expect(without).toContain("### Topic");
		expect(without).not.toContain("Next steps");
	});

	it("returns no items when there is no action section", () => {
		const { items, without } = extractActionItems("### Topic\n- a point");
		expect(items).toEqual([]);
		expect(without).toBe("### Topic\n- a point");
	});
});

describe("extractManualActionItems", () => {
	it("returns top-level unchecked items with markers stripped", () => {
		const body = [
			"- [ ] Follow up with Bob",
			"* [ ] Draft the RFC",
			"1. [ ] File the ticket",
		].join("\n");
		expect(extractManualActionItems(body)).toEqual([
			"Follow up with Bob",
			"Draft the RFC",
			"File the ticket",
		]);
	});

	it("ignores a transcript callout that trails the section body", () => {
		// enrichMeetingNote reads manual items before stripping the transcript,
		// and the transcript callout has no heading so it sits inside the last
		// section (usually "## Action items"). Its quoted lines must not become
		// action items.
		const body = [
			"- [ ] Real task",
			"",
			"> [!quote]- Transcript",
			"> Me: - [ ] this is speech, not a task",
			"> Them: hi",
		].join("\n");
		expect(extractManualActionItems(body)).toEqual(["Real task"]);
	});

	it("skips completed items and indented sub-bullets", () => {
		const body = [
			"- [x] Already done",
			"- [ ] Send the recap",
			"  - context that should be ignored",
			"  - [ ] nested task ignored",
		].join("\n");
		expect(extractManualActionItems(body)).toEqual(["Send the recap"]);
	});

	it("ignores prose, blank lines, and plain bullets", () => {
		const body = [
			"Some manual note",
			"",
			"- a plain bullet, not a task",
			"- [ ] Real task",
		].join("\n");
		expect(extractManualActionItems(body)).toEqual(["Real task"]);
	});

	it("returns nothing for an empty section", () => {
		expect(extractManualActionItems("")).toEqual([]);
	});
});

describe("refreshActionItems", () => {
	it("keeps completed items and replaces the previous unchecked set", () => {
		const existing = "- [x] done thing\n- [ ] Align on the entity model (Luca)";
		const merged = refreshActionItems(existing, [
			"- [ ] Align on the entity model (Luca)",
			"- [ ] Schedule 1:1 with Kate (Alvaro)",
		]);
		expect(merged).toBe(
			[
				"- [x] done thing",
				"- [ ] Align on the entity model (Luca)",
				"- [ ] Schedule 1:1 with Kate (Alvaro)",
			].join("\n")
		);
	});

	it("does not pile up reworded duplicates on re-enrich", () => {
		// The previous run's unchecked wording is dropped, so the same task
		// phrased differently doesn't accumulate.
		const existing = "- [ ] Schedule a meeting with Luca and Julian";
		const merged = refreshActionItems(existing, [
			"- [ ] Schedule a discussion with Luca and Julian on ownership",
		]);
		expect(merged).toBe(
			"- [ ] Schedule a discussion with Luca and Julian on ownership"
		);
	});

	it("skips a fresh item that duplicates a completed one", () => {
		const merged = refreshActionItems("- [x] Ship the thing", [
			"- [ ] **ship the thing**",
		]);
		expect(merged).toBe("- [x] Ship the thing");
	});

	it("preserves non-task prose but drops previous unchecked items", () => {
		const existing = "Some manual note\n- [ ] old task";
		const merged = refreshActionItems(existing, ["- [ ] brand new task"]);
		expect(merged).toBe("Some manual note\n- [ ] brand new task");
	});

	it("returns the fresh items when there is no existing section", () => {
		const merged = refreshActionItems("", ["- [ ] first task"]);
		expect(merged).toBe("- [ ] first task");
	});
});

// Mirrors the merge chain in enrichMeetingNote (extractActionItems ->
// refreshActionItems) to lock in the #93 fix: when the model returns a unified
// "Next steps" that carries over the hand-written items, the merge preserves
// them (improved) instead of dropping them, with no duplication.
describe("enrichment merge preserves hand-written action items", () => {
	it("keeps an improved hand-written item and appends new ones", () => {
		const existingSection = "- [ ] Follow up with Bob";
		const modelOutput = [
			"### TL;DR",
			"- shipped the thing",
			"",
			"### Next steps",
			"- **Follow up with Bob about Q3 pricing**",
			"- **Draft the launch email**",
		].join("\n");

		const { items } = extractActionItems(modelOutput);
		const merged = refreshActionItems(existingSection, items);

		expect(merged).toBe(
			[
				"- [ ] **Follow up with Bob about Q3 pricing**",
				"- [ ] **Draft the launch email**",
			].join("\n")
		);
		// The original, un-improved wording is gone (superseded, not duplicated).
		expect(merged).not.toContain("Follow up with Bob\n");
	});
});
