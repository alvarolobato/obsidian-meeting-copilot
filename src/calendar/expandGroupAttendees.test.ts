import { describe, it, expect, vi } from "vitest";
import {
	expandEmailToPeople,
	GroupExpandCache,
	mapAttendeesExpanded,
	type GroupDirectory,
	type GroupMember,
} from "./expandGroupAttendees";

function fakeDir(opts: {
	groups?: Record<string, string>;
	members?: Record<string, GroupMember[]>;
	lookupError?: Error;
	listError?: Error;
}): GroupDirectory {
	const groups = opts.groups ?? {};
	const members = opts.members ?? {};
	return {
		async lookup(email: string) {
			if (opts.lookupError) throw opts.lookupError;
			return groups[email.toLowerCase()] ?? null;
		},
		async listMembers(resource: string) {
			if (opts.listError) throw opts.listError;
			return members[resource] ?? [];
		},
	};
}

describe("expandEmailToPeople", () => {
	it("returns the email unchanged when lookup says it is not a group", async () => {
		const dir = fakeDir({});
		await expect(expandEmailToPeople("bob@x.com", dir)).resolves.toEqual([
			"bob@x.com",
		]);
	});

	it("expands a group into its USER members", async () => {
		const dir = fakeDir({
			groups: { "elg@x.com": "groups/elg" },
			members: {
				"groups/elg": [
					{ email: "a@x.com", type: "USER" },
					{ email: "b@x.com", type: "USER" },
				],
			},
		});
		await expect(expandEmailToPeople("elg@x.com", dir)).resolves.toEqual([
			"a@x.com",
			"b@x.com",
		]);
	});

	it("recurses into nested GROUP members and respects maxDepth", async () => {
		const dir = fakeDir({
			groups: {
				"team@x.com": "groups/team",
				"sub@x.com": "groups/sub",
			},
			members: {
				"groups/team": [
					{ email: "lead@x.com", type: "USER" },
					{ email: "sub@x.com", type: "GROUP" },
				],
				"groups/sub": [
					{ email: "nested@x.com", type: "USER" },
					{ email: "deeper@x.com", type: "GROUP" },
				],
				"groups/deeper": [{ email: "leaf@x.com", type: "USER" }],
			},
		});
		// maxDepth 1: expand team + one nested group level, but not deeper@ as group
		const people = await expandEmailToPeople("team@x.com", dir, {
			maxDepth: 1,
		});
		expect(people).toEqual(["lead@x.com", "nested@x.com", "deeper@x.com"]);
	});

	it("caps the number of expanded people", async () => {
		const dir = fakeDir({
			groups: { "big@x.com": "groups/big" },
			members: {
				"groups/big": Array.from({ length: 10 }, (_, i) => ({
					email: `u${i}@x.com`,
					type: "USER",
				})),
			},
		});
		const people = await expandEmailToPeople("big@x.com", dir, {
			maxPeople: 3,
		});
		expect(people).toEqual(["u0@x.com", "u1@x.com", "u2@x.com"]);
	});

	it("defaults maxPeople to 50", async () => {
		const dir = fakeDir({
			groups: { "big@x.com": "groups/big" },
			members: {
				"groups/big": Array.from({ length: 80 }, (_, i) => ({
					email: `u${i}@x.com`,
					type: "USER",
				})),
			},
		});
		const people = await expandEmailToPeople("big@x.com", dir);
		expect(people).toHaveLength(50);
		expect(people[0]).toBe("u0@x.com");
		expect(people[49]).toBe("u49@x.com");
	});

	it("disables further lookups after a hard lookup failure", async () => {
		const lookup = vi
			.fn()
			.mockRejectedValueOnce(new Error("Cloud Identity API disabled"))
			.mockResolvedValue("groups/x");
		const dir: GroupDirectory = {
			lookup,
			listMembers: async () => [],
		};
		const cache = new GroupExpandCache();
		await expect(
			expandEmailToPeople("g@x.com", dir, {}, cache)
		).resolves.toEqual(["g@x.com"]);
		expect(cache.disabled).toBe(true);
		await expect(
			expandEmailToPeople("other@x.com", dir, {}, cache)
		).resolves.toEqual(["other@x.com"]);
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	it("does not cache depth-capped nested GROUPs as person", async () => {
		const lookup = vi.fn(async (email: string) => {
			if (email === "team@x.com") return "groups/team";
			if (email === "sub@x.com") return "groups/sub";
			return null;
		});
		const dir: GroupDirectory = {
			lookup,
			async listMembers(resource: string) {
				if (resource === "groups/team") {
					return [{ email: "sub@x.com", type: "GROUP" }];
				}
				if (resource === "groups/sub") {
					return [{ email: "leaf@x.com", type: "USER" }];
				}
				return [];
			},
		};
		const cache = new GroupExpandCache();
		// Depth 0 only: nested GROUP emitted without expand, must not poison cache.
		const capped = await expandEmailToPeople("team@x.com", dir, { maxDepth: 0 }, cache);
		expect(capped).toEqual(["sub@x.com"]);
		expect(cache.kind.get("sub@x.com")).toBeUndefined();
		// Same sync: sub@ as a root invitee should still expand.
		const asRoot = await expandEmailToPeople("sub@x.com", dir, {}, cache);
		expect(asRoot).toEqual(["leaf@x.com"]);
		expect(lookup).toHaveBeenCalledWith("sub@x.com");
	});

	it("does not re-poison depth-capped GROUPs when merging nested results", async () => {
		const lookup = vi.fn(async (email: string) => {
			if (email === "team@x.com") return "groups/team";
			if (email === "sub@x.com") return "groups/sub";
			if (email === "deeper@x.com") return "groups/deeper";
			return null;
		});
		const dir: GroupDirectory = {
			lookup,
			async listMembers(resource: string) {
				if (resource === "groups/team") {
					return [{ email: "sub@x.com", type: "GROUP" }];
				}
				if (resource === "groups/sub") {
					return [{ email: "deeper@x.com", type: "GROUP" }];
				}
				if (resource === "groups/deeper") {
					return [{ email: "leaf@x.com", type: "USER" }];
				}
				return [];
			},
		};
		const cache = new GroupExpandCache();
		const capped = await expandEmailToPeople("team@x.com", dir, { maxDepth: 1 }, cache);
		expect(capped).toEqual(["deeper@x.com"]);
		expect(cache.kind.get("deeper@x.com")).toBeUndefined();
		const asRoot = await expandEmailToPeople("deeper@x.com", dir, {}, cache);
		expect(asRoot).toEqual(["leaf@x.com"]);
	});
});

describe("mapAttendeesExpanded", () => {
	it("keeps person display names and expands groups", async () => {
		const dir = fakeDir({
			groups: { "elg@x.com": "groups/elg" },
			members: {
				"groups/elg": [
					{ email: "ash@x.com", type: "USER" },
					{ email: "alvaro.lobato@x.com", type: "USER" },
				],
			},
		});
		const labels = await mapAttendeesExpanded(
			[
				{ email: "ash@x.com", displayName: "Ash" },
				{ email: "elg@x.com", displayName: "ELG" },
				{ email: "room@resource.calendar.google.com", resource: true },
			],
			dir
		);
		expect(labels).toEqual(["Ash", "Alvaro Lobato"]);
	});

	it("keeps the group label when membership list fails empty after disable", async () => {
		const dir = fakeDir({
			groups: { "elg@x.com": "groups/elg" },
			listError: new Error("boom"),
		});
		const labels = await mapAttendeesExpanded(
			[{ email: "elg@x.com", displayName: "Engineering Leadership Group" }],
			dir
		);
		expect(labels).toEqual(["Engineering Leadership Group"]);
	});

	it("dedupes a person who is both a direct invitee and a group member", async () => {
		const dir = fakeDir({
			groups: { "elg@x.com": "groups/elg" },
			members: {
				"groups/elg": [
					{ email: "ash@x.com", type: "USER" },
					{ email: "bob@x.com", type: "USER" },
				],
			},
		});
		const labels = await mapAttendeesExpanded(
			[
				{ email: "ash@x.com", displayName: "Ash" },
				{ email: "elg@x.com", displayName: "ELG" },
			],
			dir
		);
		expect(labels).toEqual(["Ash", "Bob"]);
	});

	it("prefers a direct invitee's displayName when the group is listed first", async () => {
		const dir = fakeDir({
			groups: { "elg@x.com": "groups/elg" },
			members: {
				"groups/elg": [
					{ email: "ash@x.com", type: "USER" },
					{ email: "bob@x.com", type: "USER" },
				],
			},
		});
		const labels = await mapAttendeesExpanded(
			[
				{ email: "elg@x.com", displayName: "ELG" },
				{ email: "ash@x.com", displayName: "Ash K" },
			],
			dir
		);
		expect(labels).toEqual(["Ash K", "Bob"]);
	});

	it("keeps cached group members after a later failure disables the API", async () => {
		let listCalls = 0;
		const dir: GroupDirectory = {
			async lookup(email: string) {
				if (email === "elg@x.com") return "groups/elg";
				if (email === "other@x.com") return "groups/other";
				return null;
			},
			async listMembers(resource: string) {
				listCalls += 1;
				if (resource === "groups/elg") {
					return [
						{ email: "a@x.com", type: "USER" },
						{ email: "b@x.com", type: "USER" },
					];
				}
				throw new Error("memberships.list failed");
			},
		};
		const cache = new GroupExpandCache();
		const first = await mapAttendeesExpanded(
			[{ email: "elg@x.com", displayName: "ELG" }],
			dir,
			{},
			cache
		);
		expect(first).toEqual(["A", "B"]);
		const second = await mapAttendeesExpanded(
			[{ email: "other@x.com", displayName: "Other Team" }],
			dir,
			{},
			cache
		);
		expect(cache.disabled).toBe(true);
		expect(second).toEqual(["Other Team"]);
		const third = await mapAttendeesExpanded(
			[{ email: "elg@x.com", displayName: "ELG" }],
			dir,
			{},
			cache
		);
		expect(third).toEqual(["A", "B"]);
		expect(listCalls).toBe(2);
	});

	it("keeps raw email for people without a displayName", async () => {
		const dir = fakeDir({});
		const labels = await mapAttendeesExpanded(
			[{ email: "jsmith@x.com" }],
			dir
		);
		expect(labels).toEqual(["jsmith@x.com"]);
	});
});
