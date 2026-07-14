import { describe, expect, it } from "vitest";
import { extractActionItems, refreshActionItems } from "./actionItems";

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
