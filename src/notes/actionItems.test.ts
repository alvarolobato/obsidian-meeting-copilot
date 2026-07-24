import { describe, expect, it } from "vitest";
import {
	extractActionItems,
	extractFollowUps,
	extractManualActionItems,
	refreshActionItems,
	stampCreatedDate,
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

	it("does not treat Follow-ups as personal action items", () => {
		const md = [
			"### Next steps",
			"- **Ship the release**",
			"",
			"### Follow-ups",
			"- **Kate:** Send the doc",
		].join("\n");
		const { items, without } = extractActionItems(md);
		expect(items).toEqual(["- [ ] **Ship the release**"]);
		expect(without).toContain("### Follow-ups");
		expect(without).toContain("**Kate:** Send the doc");
	});

	it("returns no items when there is no action section", () => {
		const { items, without } = extractActionItems("### Topic\n- a point");
		expect(items).toEqual([]);
		expect(without).toBe("### Topic\n- a point");
	});
});

describe("extractFollowUps", () => {
	it("converts a Follow-ups section into task lines and strips it", () => {
		const md = [
			"### Next steps",
			"- **My task**",
			"",
			"### Follow-ups",
			"- **Kate:** Send the architecture doc",
			"  - she promised Friday",
			"- Book the kickoff room",
		].join("\n");
		const { items, without } = extractFollowUps(md);
		expect(items).toEqual([
			"- [ ] **Kate:** Send the architecture doc",
			"- [ ] Book the kickoff room",
		]);
		expect(without).toContain("### Next steps");
		expect(without).not.toContain("Follow-ups");
	});

	it("returns no items when there is no follow-ups section", () => {
		const { items, without } = extractFollowUps("### Next steps\n- a");
		expect(items).toEqual([]);
		expect(without).toBe("### Next steps\n- a");
	});
});

describe("stampCreatedDate", () => {
	it("appends a creation stamp to fresh items", () => {
		expect(stampCreatedDate(["- [ ] Ship it"], "2026-07-24")).toEqual([
			"- [ ] Ship it ➕ 2026-07-24",
		]);
	});

	it("does not double-stamp", () => {
		expect(
			stampCreatedDate(["- [ ] Ship it ➕ 2026-07-01"], "2026-07-24")
		).toEqual(["- [ ] Ship it ➕ 2026-07-01"]);
	});

	it("keeps a trailing block ref after the stamp", () => {
		expect(
			stampCreatedDate(["- [ ] Ship it ^abc"], "2026-07-24")
		).toEqual(["- [ ] Ship it ➕ 2026-07-24 ^abc"]);
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

	it("captures a uniformly-indented top-level list", () => {
		const body = ["  - [ ] Indented task one", "  * [ ] Indented task two"].join(
			"\n"
		);
		expect(extractManualActionItems(body)).toEqual([
			"Indented task one",
			"Indented task two",
		]);
	});

	it("keeps only the least-indented tasks when nesting is mixed", () => {
		const body = [
			"- [ ] Parent task",
			"  - [ ] nested detail task",
			"- [ ] Sibling task",
		].join("\n");
		expect(extractManualActionItems(body)).toEqual([
			"Parent task",
			"Sibling task",
		]);
	});

	it("ignores a transcript callout that trails the section body", () => {
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

	it("replaces an ordered unchecked task without duplicating it", () => {
		const merged = refreshActionItems("1. [ ] Follow up with Bob", [
			"- [ ] Follow up with Bob about pricing",
		]);
		expect(merged).toBe("- [ ] Follow up with Bob about pricing");
	});

	it("keeps a completed ordered task and dedupes a matching fresh item", () => {
		const merged = refreshActionItems("1. [x] Ship the thing", [
			"- [ ] **ship the thing**",
		]);
		expect(merged).toBe("1. [x] Ship the thing");
	});
});

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
		expect(merged).not.toContain("Follow up with Bob\n");
	});
});

describe("enrichment merge preserves hand-written follow-ups", () => {
	it("unifies follow-ups separately from next steps", () => {
		const existing = "- [ ] **Kate:** Send doc";
		const modelOutput = [
			"### Next steps",
			"- **My personal task**",
			"",
			"### Follow-ups",
			"- **Kate:** Send the architecture doc",
			"- Book the room",
		].join("\n");

		const actions = extractActionItems(modelOutput);
		const followUps = extractFollowUps(actions.without);
		const mergedFollowUps = refreshActionItems(
			existing,
			stampCreatedDate(followUps.items, "2026-07-24")
		);

		expect(actions.items).toEqual(["- [ ] **My personal task**"]);
		expect(mergedFollowUps).toBe(
			[
				"- [ ] **Kate:** Send the architecture doc ➕ 2026-07-24",
				"- [ ] Book the room ➕ 2026-07-24",
			].join("\n")
		);
	});
});
