import { describe, expect, it } from "vitest";
import {
	cleanTaskText,
	countTasks,
	mergeGroupsByKey,
	parseNoteTasks,
	parseTaskOwner,
	sortActionNoteGroups,
	splitByHorizon,
	taskAgeDays,
	tasksOutsideHeadings,
	type ActionNoteGroup,
	type ActionTask,
	type GroupedTask,
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

function groupedTask(
	over: Partial<GroupedTask> & Pick<GroupedTask, "text">
): GroupedTask {
	return {
		...task(over),
		path: "Meetings/x.md",
		noteDate: null,
		...over,
	};
}

function group(over: Partial<ActionNoteGroup>): ActionNoteGroup {
	return {
		key: "note:Meetings/x.md",
		title: "x",
		notePath: "Meetings/x.md",
		date: new Date("2026-07-10T10:00:00"),
		category: "ad-hoc",
		tasks: [groupedTask({ text: "do it" })],
		...over,
	};
}

describe("sortActionNoteGroups", () => {
	it("orders notes newest-first by date", () => {
		const sorted = sortActionNoteGroups([
			group({ key: "a", date: new Date("2026-07-01T00:00:00") }),
			group({ key: "b", date: new Date("2026-07-10T00:00:00") }),
			group({ key: "c", date: new Date("2026-07-05T00:00:00") }),
		]);
		expect(sorted.map((g) => g.key)).toEqual(["b", "c", "a"]);
	});

	it("puts dateless notes last, tie-breaking on key", () => {
		const sorted = sortActionNoteGroups([
			group({ key: "z", date: null }),
			group({ key: "a", date: null }),
			group({ key: "dated", date: new Date("2026-07-01T00:00:00") }),
		]);
		expect(sorted.map((g) => g.key)).toEqual(["dated", "a", "z"]);
	});

	it("drops groups with no tasks", () => {
		const sorted = sortActionNoteGroups([
			group({ key: "empty", tasks: [] }),
			group({ key: "has" }),
		]);
		expect(sorted.map((g) => g.key)).toEqual(["has"]);
	});

	it("keeps a group whose only tasks are recently-done (grace period)", () => {
		const sorted = sortActionNoteGroups([
			group({
				key: "done",
				tasks: [
					groupedTask({
						text: "d",
						raw: "- [x] d ✅ 2026-07-10",
						done: true,
					}),
				],
			}),
		]);
		expect(sorted.map((g) => g.key)).toEqual(["done"]);
	});
});

describe("countTasks", () => {
	it("sums open tasks across groups, excluding done ones", () => {
		expect(
			countTasks([
				group({
					tasks: [
						groupedTask({ text: "a", line: 1 }),
						groupedTask({ text: "b", line: 2 }),
						groupedTask({ text: "c", line: 3, done: true, raw: "- [x] c" }),
					],
				}),
				group({
					tasks: [groupedTask({ text: "d" })],
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

describe("tasksOutsideHeadings", () => {
	const today = "2026-07-15";

	it("returns tasks under an unrecognized heading (e.g. a Granola import's own structure)", () => {
		const body = [
			"### Next Steps",
			"- [ ] check the thing",
			"- [ ] follow up with them",
		].join("\n");
		const tasks = tasksOutsideHeadings(body, today, [
			"## Action items",
			"## Follow-ups",
		]);
		expect(tasks.map((t) => t.text)).toEqual([
			"check the thing",
			"follow up with them",
		]);
	});

	it("excludes tasks already claimed by a recognized heading", () => {
		const body = [
			"## Random other section",
			"- [ ] orphan",
			"",
			"## Action items",
			"- [ ] mine",
			"",
			"## Follow-ups",
			"- [ ] theirs",
		].join("\n");
		const tasks = tasksOutsideHeadings(body, today, [
			"## Action items",
			"## Follow-ups",
		]);
		expect(tasks.map((t) => t.text)).toEqual(["orphan"]);
	});

	it("returns nothing when every task is already under a recognized heading", () => {
		const body = ["## Action items", "- [ ] mine"].join("\n");
		expect(
			tasksOutsideHeadings(body, today, ["## Action items", "## Follow-ups"])
		).toEqual([]);
	});
});

describe("taskAgeDays / splitByHorizon", () => {
	const today = new Date(2026, 6, 24); // local Jul 24

	it("prefers the creation stamp over the note date", () => {
		const age = taskAgeDays(
			groupedTask({
				text: "x",
				created: new Date(2026, 6, 10),
				noteDate: new Date(2026, 0, 1),
			}),
			today
		);
		expect(age).toBe(14);
	});

	it("falls back to the note date when unstamped", () => {
		expect(
			taskAgeDays(
				groupedTask({ text: "x", noteDate: new Date(2026, 6, 20) }),
				today
			)
		).toBe(4);
	});

	it("splits groups by horizon and keeps unknown-age tasks recent", () => {
		const groups = [
			group({
				key: "old",
				date: new Date(2026, 4, 1),
				tasks: [
					groupedTask({
						text: "stale",
						created: new Date(2026, 4, 1),
					}),
				],
			}),
			group({
				key: "undated",
				date: null,
				tasks: [groupedTask({ text: "no dates" })],
			}),
			group({
				key: "fresh",
				date: new Date(2026, 6, 20),
				tasks: [
					groupedTask({ text: "new", created: new Date(2026, 6, 20) }),
				],
			}),
		];
		const split = splitByHorizon(groups, 45, today);
		expect(split.recent.map((g) => g.key)).toEqual(["undated", "fresh"]);
		expect(split.older.map((g) => g.key)).toEqual(["old"]);
	});

	it("disables filtering when horizon is 0", () => {
		const groups = [
			group({
				tasks: [
					groupedTask({ text: "old", created: new Date(2020, 0, 1) }),
				],
			}),
		];
		const split = splitByHorizon(groups, 0, today);
		expect(split.recent).toEqual(groups);
		expect(split.older).toEqual([]);
	});
});

describe("mergeGroupsByKey", () => {
	it("unions tasks from the same group so Show older is not duplicated", () => {
		const split = splitByHorizon(
			[
				group({
					key: "note:Meetings/sync.md",
					date: new Date(2026, 6, 1),
					tasks: [
						groupedTask({
							text: "fresh",
							created: new Date(2026, 6, 20),
						}),
						groupedTask({
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
		const merged = mergeGroupsByKey([...split.recent, ...split.older]);
		expect(merged).toHaveLength(1);
		expect(merged[0]!.tasks.map((t) => t.text).sort()).toEqual([
			"fresh",
			"stale",
		]);
	});

	it("merges a 1:1's tasks across two different notes into one section", () => {
		const merged = mergeGroupsByKey([
			group({
				key: "11:andres@example.com",
				title: "1:1 · Andres",
				notePath: "Meetings/1on1/Andres/2026-07-30.md",
				category: "one-on-one",
				tasks: [groupedTask({ text: "a", path: "Meetings/1on1/Andres/2026-07-30.md" })],
			}),
			group({
				key: "11:andres@example.com",
				title: "1:1 · Andres",
				notePath: "Meetings/1on1/Andres/2026-07-16.md",
				category: "one-on-one",
				tasks: [groupedTask({ text: "b", path: "Meetings/1on1/Andres/2026-07-16.md" })],
			}),
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0]!.tasks.map((t) => t.text).sort()).toEqual(["a", "b"]);
	});
});
