import { describe, expect, it } from "vitest";
import {
	cleanTaskText,
	countTasks,
	mergeGroupsByPath,
	parseNoteTasks,
	parseTaskOwner,
	sortActionNoteGroups,
	splitByHorizon,
	taskAgeDays,
	type ActionNoteGroup,
	type ActionTask,
} from "./dashboardActions";

function task(over: Partial<ActionTask> & Pick<ActionTask, "text">): ActionTask {
	return {
		raw: `- [ ] ${over.text}`,
		line: 1,
		done: false,
		owner: null,
		created: null,
		...over,
	};
}

function group(over: Partial<ActionNoteGroup>): ActionNoteGroup {
	return {
		path: "Meetings/x.md",
		title: "x",
		date: new Date("2026-07-10T10:00:00"),
		tasks: [task({ text: "do it" })],
		...over,
	};
}

describe("sortActionNoteGroups", () => {
	it("orders notes newest-first by date", () => {
		const sorted = sortActionNoteGroups([
			group({ path: "a.md", date: new Date("2026-07-01T00:00:00") }),
			group({ path: "b.md", date: new Date("2026-07-10T00:00:00") }),
			group({ path: "c.md", date: new Date("2026-07-05T00:00:00") }),
		]);
		expect(sorted.map((g) => g.path)).toEqual(["b.md", "c.md", "a.md"]);
	});

	it("puts dateless notes last, tie-breaking on path", () => {
		const sorted = sortActionNoteGroups([
			group({ path: "z.md", date: null }),
			group({ path: "a.md", date: null }),
			group({ path: "dated.md", date: new Date("2026-07-01T00:00:00") }),
		]);
		expect(sorted.map((g) => g.path)).toEqual([
			"dated.md",
			"a.md",
			"z.md",
		]);
	});

	it("drops groups with no tasks", () => {
		const sorted = sortActionNoteGroups([
			group({ path: "empty.md", tasks: [] }),
			group({ path: "has.md" }),
		]);
		expect(sorted.map((g) => g.path)).toEqual(["has.md"]);
	});

	it("keeps a group whose only tasks are recently-done (grace period)", () => {
		const sorted = sortActionNoteGroups([
			group({
				path: "done.md",
				tasks: [
					task({
						text: "d",
						raw: "- [x] d ✅ 2026-07-10",
						done: true,
					}),
				],
			}),
		]);
		expect(sorted.map((g) => g.path)).toEqual(["done.md"]);
	});
});

describe("countTasks", () => {
	it("sums open tasks across groups, excluding done ones", () => {
		expect(
			countTasks([
				group({
					tasks: [
						task({ text: "a", line: 1 }),
						task({ text: "b", line: 2 }),
						task({ text: "c", line: 3, done: true, raw: "- [x] c" }),
					],
				}),
				group({
					tasks: [task({ text: "d" })],
				}),
			])
		).toBe(3);
	});
});

describe("cleanTaskText", () => {
	it("strips the list marker and checkbox", () => {
		expect(cleanTaskText("- [ ] call Sam")).toBe("call Sam");
		expect(cleanTaskText("  * [x] done thing")).toBe("done thing");
	});

	it("strips a trailing completion date", () => {
		expect(cleanTaskText("- [x] ship it ✅ 2026-07-15")).toBe("ship it");
	});

	it("strips a creation stamp", () => {
		expect(cleanTaskText("- [ ] ship it ➕ 2026-07-15")).toBe("ship it");
	});

	it("strips a completion date even when a block ref follows it", () => {
		expect(cleanTaskText("- [x] ship it ✅ 2026-07-15 ^abc123")).toBe(
			"ship it"
		);
	});

	it("strips a trailing block ref on an open task", () => {
		expect(cleanTaskText("- [ ] review PR ^task-1")).toBe("review PR");
	});

	it("keeps inner text intact (links, emphasis)", () => {
		expect(cleanTaskText("- [ ] ping **@Sam** re [[Notes]]")).toBe(
			"ping **@Sam** re [[Notes]]"
		);
	});
});

describe("parseTaskOwner", () => {
	it("parses a bold owner prefix", () => {
		expect(parseTaskOwner("**Kate:** Send the doc")).toEqual({
			owner: "Kate",
			body: "Send the doc",
		});
		expect(parseTaskOwner("**Kate**: Send the doc")).toEqual({
			owner: "Kate",
			body: "Send the doc",
		});
	});

	it("returns null owner when unassigned", () => {
		expect(parseTaskOwner("Book the room")).toEqual({
			owner: null,
			body: "Book the room",
		});
	});
});

describe("parseNoteTasks", () => {
	const today = "2026-07-15";

	it("collects open tasks with their line index and raw line", () => {
		const body = ["# Title", "- [ ] first", "text", "- [ ] second"].join(
			"\n"
		);
		const tasks = parseNoteTasks(body, today);
		expect(tasks).toEqual([
			{
				line: 1,
				raw: "- [ ] first",
				text: "first",
				done: false,
				owner: null,
				created: null,
			},
			{
				line: 3,
				raw: "- [ ] second",
				text: "second",
				done: false,
				owner: null,
				created: null,
			},
		]);
	});

	it("keeps a done task completed today, drops one completed earlier", () => {
		const body = [
			"- [x] today ✅ 2026-07-15",
			"- [x] yesterday ✅ 2026-07-14",
			"- [x] undated",
		].join("\n");
		const tasks = parseNoteTasks(body, today);
		expect(tasks).toEqual([
			{
				line: 0,
				raw: "- [x] today ✅ 2026-07-15",
				text: "today",
				done: true,
				owner: null,
				created: null,
			},
		]);
	});

	it("returns nothing for a note without checkbox tasks", () => {
		expect(parseNoteTasks("# just prose\n- a bullet", today)).toEqual([]);
	});

	it("scopes to a section and preserves absolute line indexes", () => {
		const body = [
			"## Action items",
			"- [ ] mine",
			"",
			"## Follow-ups",
			"- [ ] **Kate:** theirs ➕ 2026-07-10",
			"- [ ] unassigned",
		].join("\n");
		const mine = parseNoteTasks(body, today, "## Action items");
		expect(mine).toEqual([
			{
				line: 1,
				raw: "- [ ] mine",
				text: "mine",
				done: false,
				owner: null,
				created: null,
			},
		]);
		const followUps = parseNoteTasks(body, today, "## Follow-ups");
		expect(followUps.map((t) => ({ line: t.line, text: t.text, owner: t.owner }))).toEqual([
			{ line: 4, text: "**Kate:** theirs", owner: "Kate" },
			{ line: 5, text: "unassigned", owner: null },
		]);
		expect(followUps[0]!.created?.getFullYear()).toBe(2026);
		expect(followUps[0]!.created?.getMonth()).toBe(6);
		expect(followUps[0]!.created?.getDate()).toBe(10);
	});

	it("returns nothing when the section heading is absent", () => {
		expect(
			parseNoteTasks("- [ ] orphan", today, "## Follow-ups")
		).toEqual([]);
	});
});

describe("taskAgeDays / splitByHorizon", () => {
	const today = new Date(2026, 6, 24); // local Jul 24

	it("prefers the creation stamp over the note date", () => {
		const age = taskAgeDays(
			task({
				text: "x",
				created: new Date(2026, 6, 10),
			}),
			new Date(2026, 0, 1),
			today
		);
		expect(age).toBe(14);
	});

	it("falls back to the note date when unstamped", () => {
		expect(
			taskAgeDays(task({ text: "x" }), new Date(2026, 6, 20), today)
		).toBe(4);
	});

	it("splits groups by horizon and keeps unknown-age tasks recent", () => {
		const groups = [
			group({
				path: "old.md",
				date: new Date(2026, 4, 1),
				tasks: [
					task({
						text: "stale",
						created: new Date(2026, 4, 1),
					}),
				],
			}),
			group({
				path: "undated.md",
				date: null,
				tasks: [task({ text: "no dates" })],
			}),
			group({
				path: "fresh.md",
				date: new Date(2026, 6, 20),
				tasks: [task({ text: "new", created: new Date(2026, 6, 20) })],
			}),
		];
		const split = splitByHorizon(groups, 45, today);
		expect(split.recent.map((g) => g.path)).toEqual([
			"undated.md",
			"fresh.md",
		]);
		expect(split.older.map((g) => g.path)).toEqual(["old.md"]);
	});

	it("disables filtering when horizon is 0", () => {
		const groups = [
			group({
				tasks: [
					task({ text: "old", created: new Date(2020, 0, 1) }),
				],
			}),
		];
		const split = splitByHorizon(groups, 0, today);
		expect(split.recent).toEqual(groups);
		expect(split.older).toEqual([]);
	});
});

describe("mergeGroupsByPath", () => {
	it("unions tasks from the same note so Show older is not duplicated", () => {
		const split = splitByHorizon(
			[
				group({
					path: "Meetings/sync.md",
					date: new Date(2026, 6, 1),
					tasks: [
						task({
							text: "fresh",
							created: new Date(2026, 6, 20),
						}),
						task({
							text: "stale",
							created: new Date(2026, 4, 1),
						}),
					],
				}),
			],
			45,
			new Date(2026, 6, 24)
		);
		expect(split.recent).toHaveLength(1);
		expect(split.older).toHaveLength(1);
		const merged = mergeGroupsByPath([...split.recent, ...split.older]);
		expect(merged).toHaveLength(1);
		expect(merged[0]!.tasks.map((t) => t.text).sort()).toEqual([
			"fresh",
			"stale",
		]);
	});
});
