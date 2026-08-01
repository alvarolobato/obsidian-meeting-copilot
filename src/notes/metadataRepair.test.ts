import { describe, expect, it } from "vitest";
import {
	findNoteIssues,
	inferIdentityFromSiblings,
	type NoteIdentityRow,
	type SiblingIdentity,
} from "./metadataRepair";

function sibling(over: Partial<SiblingIdentity>): SiblingIdentity {
	return {
		oneOnOneWith: null,
		oneOnOneEmail: null,
		recurringEventId: null,
		title: "x",
		...over,
	};
}

function row(over: Partial<NoteIdentityRow> & Pick<NoteIdentityRow, "path">): NoteIdentityRow {
	return {
		title: over.path,
		fileTitle: over.path,
		folder: "Meetings/Andres",
		looksLikeMeetingNote: true,
		oneOnOneWith: null,
		oneOnOneEmail: null,
		recurringEventId: null,
		...over,
	};
}

describe("inferIdentityFromSiblings", () => {
	it("returns none with no signal at all", () => {
		expect(inferIdentityFromSiblings([sibling({}), sibling({})])).toEqual({
			kind: "none",
		});
	});

	it("infers a 1:1 partner matched by email", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@example.com" }),
			sibling({ oneOnOneWith: "Andres R.", oneOnOneEmail: "andres@example.com" }),
		]);
		expect(result).toEqual({
			kind: "resolved",
			identity: {
				kind: "one-on-one",
				name: "Andres",
				email: "andres@example.com",
			},
		});
	});

	it("infers a 1:1 partner matched by name when no email is stamped", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres" }),
			sibling({ oneOnOneWith: "Andres" }),
		]);
		expect(result).toEqual({
			kind: "resolved",
			identity: { kind: "one-on-one", name: "Andres", email: null },
		});
	});

	it("infers a recurring series, using the first sibling's title", () => {
		const result = inferIdentityFromSiblings([
			sibling({ recurringEventId: "abc123", title: "NS-LT" }),
			sibling({ recurringEventId: "abc123", title: "NS-LT (renamed instance)" }),
		]);
		expect(result).toEqual({
			kind: "resolved",
			identity: {
				kind: "recurring",
				recurringEventId: "abc123",
				title: "NS-LT",
			},
		});
	});

	it("reports both candidates when siblings mix two different 1:1 partners", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@example.com" }),
			sibling({ oneOnOneWith: "Baha", oneOnOneEmail: "baha@example.com" }),
		]);
		expect(result).toEqual({
			kind: "ambiguous",
			oneOnOnes: [
				{ name: "Andres", email: "andres@example.com", count: 1 },
				{ name: "Baha", email: "baha@example.com", count: 1 },
			],
			recurring: [],
		});
	});

	it("reports both candidates when siblings mix two different recurring series", () => {
		const result = inferIdentityFromSiblings([
			sibling({ recurringEventId: "abc", title: "Weekly Sync" }),
			sibling({ recurringEventId: "def", title: "Monthly Review" }),
		]);
		expect(result).toEqual({
			kind: "ambiguous",
			oneOnOnes: [],
			recurring: [
				{ recurringEventId: "abc", title: "Weekly Sync", count: 1 },
				{ recurringEventId: "def", title: "Monthly Review", count: 1 },
			],
		});
	});

	it("reports both candidates when siblings mix a 1:1 and a recurring series", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@example.com" }),
			sibling({ recurringEventId: "abc", title: "Weekly Sync" }),
		]);
		expect(result).toEqual({
			kind: "ambiguous",
			oneOnOnes: [{ name: "Andres", email: "andres@example.com", count: 1 }],
			recurring: [{ recurringEventId: "abc", title: "Weekly Sync", count: 1 }],
		});
	});

	it("counts siblings per candidate, so two series sharing a title (e.g. Calendar recreated the recurring event under a new ID) can still be told apart", () => {
		const result = inferIdentityFromSiblings([
			sibling({ recurringEventId: "old-id", title: "Weekly Sync" }),
			sibling({ recurringEventId: "old-id", title: "Weekly Sync" }),
			sibling({ recurringEventId: "old-id", title: "Weekly Sync" }),
			sibling({ recurringEventId: "new-id", title: "Weekly Sync" }),
		]);
		expect(result).toEqual({
			kind: "ambiguous",
			oneOnOnes: [],
			recurring: [
				{ recurringEventId: "old-id", title: "Weekly Sync", count: 3 },
				{ recurringEventId: "new-id", title: "Weekly Sync", count: 1 },
			],
		});
	});

	it("treats two lineages of a Google-split series (same base id, different _R<timestamp> suffix) as one candidate", () => {
		const result = inferIdentityFromSiblings([
			sibling({
				recurringEventId: "abc123_R20260601T090000",
				title: "Weekly Sync",
			}),
			sibling({
				recurringEventId: "abc123_R20260615T090000",
				title: "Weekly Sync",
			}),
		]);
		expect(result).toEqual({
			kind: "resolved",
			identity: {
				kind: "recurring",
				recurringEventId: "abc123_R20260601T090000",
				title: "Weekly Sync",
			},
		});
	});

	it("prefers 1:1 identity for a sibling that is both recurring and a 1:1", () => {
		// A weekly 1:1 carries both fields — this must not look "mixed".
		const result = inferIdentityFromSiblings([
			sibling({
				oneOnOneWith: "Sophie",
				oneOnOneEmail: "sophie@example.com",
				recurringEventId: "abc123",
				title: "1:1 Sophie <> Alvaro",
			}),
		]);
		expect(result).toEqual({
			kind: "resolved",
			identity: { kind: "one-on-one", name: "Sophie", email: "sophie@example.com" },
		});
	});

	it("treats two different emails for the same display name as different people", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@a.com" }),
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@b.com" }),
		]);
		expect(result).toEqual({
			kind: "ambiguous",
			oneOnOnes: [
				{ name: "Andres", email: "andres@a.com", count: 1 },
				{ name: "Andres", email: "andres@b.com", count: 1 },
			],
			recurring: [],
		});
	});
});

describe("findNoteIssues", () => {
	it("flags an untagged note whose folder siblings agree on one identity", () => {
		const rows = [
			row({
				path: "a.md",
				oneOnOneWith: "Andres",
				oneOnOneEmail: "andres@x.com",
			}),
			row({ path: "b.md" }),
		];
		const issues = findNoteIssues(rows, true);
		expect(issues).toEqual([
			{
				path: "b.md",
				title: "b.md",
				folder: "Meetings/Andres",
				reason: {
					kind: "missing",
					identity: { kind: "one-on-one", name: "Andres", email: "andres@x.com" },
				},
			},
		]);
	});

	it("does not flag a folder with no signal at all (genuinely ad-hoc)", () => {
		const rows = [row({ path: "a.md" }), row({ path: "b.md" })];
		expect(findNoteIssues(rows, true)).toEqual([]);
	});

	it("flags every note in an ambiguous folder", () => {
		const rows = [
			row({ path: "a.md", oneOnOneWith: "Andres", oneOnOneEmail: "andres@x.com" }),
			row({ path: "b.md", oneOnOneWith: "Baha", oneOnOneEmail: "baha@x.com" }),
			row({ path: "c.md" }),
		];
		const issues = findNoteIssues(rows, true);
		expect(issues.map((i) => i.path).sort()).toEqual(["a.md", "b.md", "c.md"]);
		expect(issues.every((i) => i.reason.kind === "ambiguous")).toBe(true);
	});

	it("flags a tagged note that disagrees with its folder's majority identity", () => {
		const rows = [
			row({ path: "a.md", oneOnOneWith: "Andres", oneOnOneEmail: "andres@x.com" }),
			row({ path: "b.md", oneOnOneWith: "Andres", oneOnOneEmail: "andres@x.com" }),
			row({ path: "c.md", oneOnOneWith: "Baha", oneOnOneEmail: "baha@x.com" }),
		];
		const issues = findNoteIssues(rows, true);
		expect(issues).toEqual([
			{
				path: "c.md",
				title: "c.md",
				folder: "Meetings/Andres",
				reason: {
					kind: "outlier",
					actual: { kind: "one-on-one", name: "Baha", email: "baha@x.com" },
					expected: { kind: "one-on-one", name: "Andres", email: "andres@x.com" },
				},
			},
		]);
	});

	it("ignores rows that don't look like meeting notes at all", () => {
		const rows = [
			row({
				path: "a.md",
				oneOnOneWith: "Andres",
				oneOnOneEmail: "andres@x.com",
			}),
			row({ path: "b.md", looksLikeMeetingNote: false }),
		];
		expect(findNoteIssues(rows, true)).toEqual([]);
	});

	it("doesn't flag missing 1:1 identity when oneOnOneSeparately is off", () => {
		const rows = [
			row({
				path: "a.md",
				oneOnOneWith: "Andres",
				oneOnOneEmail: "andres@x.com",
			}),
			row({ path: "b.md" }),
		];
		expect(findNoteIssues(rows, false)).toEqual([]);
	});

	it("still flags a recurring-series gap even when oneOnOneSeparately is off", () => {
		const rows = [
			row({ path: "a.md", recurringEventId: "abc", title: "Weekly", folder: "Meetings/Weekly" }),
			row({ path: "b.md", folder: "Meetings/Weekly" }),
		];
		const issues = findNoteIssues(rows, false);
		expect(issues).toEqual([
			{
				path: "b.md",
				title: "b.md",
				folder: "Meetings/Weekly",
				reason: {
					kind: "missing",
					identity: { kind: "recurring", recurringEventId: "abc", title: "Weekly" },
				},
			},
		]);
	});

	it("uses the note's own basename as the issue title, not the shared series title", () => {
		const rows = [
			row({
				path: "Meetings/Weekly/2026-01-05 Weekly Sync.md",
				fileTitle: "2026-01-05 Weekly Sync",
				recurringEventId: "abc",
				title: "Weekly Sync",
				folder: "Meetings/Weekly",
			}),
			row({
				path: "Meetings/Weekly/2026-01-12 Weekly Sync.md",
				fileTitle: "2026-01-12 Weekly Sync",
				folder: "Meetings/Weekly",
			}),
		];
		const issues = findNoteIssues(rows, true);
		expect(issues).toEqual([
			{
				path: "Meetings/Weekly/2026-01-12 Weekly Sync.md",
				title: "2026-01-12 Weekly Sync",
				folder: "Meetings/Weekly",
				reason: {
					kind: "missing",
					identity: { kind: "recurring", recurringEventId: "abc", title: "Weekly Sync" },
				},
			},
		]);
	});

	it("doesn't flag a folder as ambiguous just because Google split its series lineage", () => {
		// Same real series, two raw ids (a lineage split) — should resolve
		// to one recurring identity and flag only the genuinely untagged
		// note, not mark the whole folder ambiguous.
		const rows = [
			row({
				path: "a.md",
				recurringEventId: "abc123_R20260601T090000",
				title: "Weekly Sync",
				folder: "Meetings/Weekly",
			}),
			row({
				path: "b.md",
				recurringEventId: "abc123_R20260615T090000",
				title: "Weekly Sync",
				folder: "Meetings/Weekly",
			}),
			row({ path: "c.md", folder: "Meetings/Weekly" }),
		];
		const issues = findNoteIssues(rows, true);
		expect(issues).toEqual([
			{
				path: "c.md",
				title: "c.md",
				folder: "Meetings/Weekly",
				reason: {
					kind: "missing",
					identity: {
						kind: "recurring",
						recurringEventId: "abc123_R20260601T090000",
						title: "Weekly Sync",
					},
				},
			},
		]);
	});

	it("keeps different folders independent", () => {
		const rows = [
			row({ path: "a.md", oneOnOneWith: "Andres", oneOnOneEmail: "andres@x.com", folder: "F1" }),
			row({ path: "b.md", folder: "F1" }),
			row({ path: "c.md", folder: "F2" }),
		];
		const issues = findNoteIssues(rows, true);
		expect(issues.map((i) => i.path)).toEqual(["b.md"]);
	});
});
