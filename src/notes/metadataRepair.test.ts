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
	it("returns null with no signal at all", () => {
		expect(inferIdentityFromSiblings([sibling({}), sibling({})])).toBeNull();
	});

	it("infers a 1:1 partner matched by email", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@example.com" }),
			sibling({ oneOnOneWith: "Andres R.", oneOnOneEmail: "andres@example.com" }),
		]);
		expect(result).toEqual({
			kind: "one-on-one",
			name: "Andres",
			email: "andres@example.com",
		});
	});

	it("infers a 1:1 partner matched by name when no email is stamped", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres" }),
			sibling({ oneOnOneWith: "Andres" }),
		]);
		expect(result).toEqual({ kind: "one-on-one", name: "Andres", email: null });
	});

	it("infers a recurring series, using the first sibling's title", () => {
		const result = inferIdentityFromSiblings([
			sibling({ recurringEventId: "abc123", title: "NS-LT" }),
			sibling({ recurringEventId: "abc123", title: "NS-LT (renamed instance)" }),
		]);
		expect(result).toEqual({
			kind: "recurring",
			recurringEventId: "abc123",
			title: "NS-LT",
		});
	});

	it("returns null when siblings mix two different 1:1 partners", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres" }),
			sibling({ oneOnOneWith: "Baha" }),
		]);
		expect(result).toBeNull();
	});

	it("returns null when siblings mix two different recurring series", () => {
		const result = inferIdentityFromSiblings([
			sibling({ recurringEventId: "abc" }),
			sibling({ recurringEventId: "def" }),
		]);
		expect(result).toBeNull();
	});

	it("returns null when siblings mix a 1:1 and a recurring series", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres" }),
			sibling({ recurringEventId: "abc" }),
		]);
		expect(result).toBeNull();
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
			kind: "one-on-one",
			name: "Sophie",
			email: "sophie@example.com",
		});
	});

	it("treats two different emails for the same display name as different people", () => {
		const result = inferIdentityFromSiblings([
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@a.com" }),
			sibling({ oneOnOneWith: "Andres", oneOnOneEmail: "andres@b.com" }),
		]);
		expect(result).toBeNull();
	});
});
