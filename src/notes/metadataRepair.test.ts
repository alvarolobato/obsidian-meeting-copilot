import { describe, expect, it } from "vitest";
import { inferIdentityFromSiblings, type SiblingIdentity } from "./metadataRepair";

function sibling(over: Partial<SiblingIdentity>): SiblingIdentity {
	return {
		oneOnOneWith: null,
		oneOnOneEmail: null,
		recurringEventId: null,
		title: "x",
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
