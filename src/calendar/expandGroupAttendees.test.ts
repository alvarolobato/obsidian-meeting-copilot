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

	it("caches person/group kind across calls", async () => {
		const lookup = vi.fn().mockResolvedValue(null);
		const dir: GroupDirectory = {
			lookup,
			listMembers: async () => [],
		};
		const cache = new GroupExpandCache();
		await expandEmailToPeople("bob@x.com", dir, {}, cache);
		await expandEmailToPeople("bob@x.com", dir, {}, cache);
		expect(lookup).toHaveBeenCalledTimes(1);
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
});
