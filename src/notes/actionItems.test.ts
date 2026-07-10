import { describe, expect, it } from "vitest";
import { extractActionItems, mergeActionItems } from "./actionItems";

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

describe("mergeActionItems", () => {
	it("preserves existing tasks and appends only new ones", () => {
		const existing = "- [x] done thing\n- [ ] Align on the entity model (Luca)";
		const merged = mergeActionItems(existing, [
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

	it("dedupes ignoring bold and casing", () => {
		const merged = mergeActionItems("- [ ] Ship the thing", [
			"- [ ] **ship the thing**",
		]);
		expect(merged).toBe("- [ ] Ship the thing");
	});

	it("preserves non-task text under the section", () => {
		const existing = "Some manual note\n- [ ] existing task";
		const merged = mergeActionItems(existing, ["- [ ] brand new task"]);
		expect(merged).toBe(
			"Some manual note\n- [ ] existing task\n- [ ] brand new task"
		);
	});
});
