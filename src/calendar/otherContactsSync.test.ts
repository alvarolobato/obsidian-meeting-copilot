import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setRequestUrl } from "../../test/obsidian-mock";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { DirectoryCache } from "./directoryCache";
import { syncOtherContacts } from "./otherContactsSync";

function fakeOauth(): GoogleOAuth {
	return { getAccessToken: async () => "tok" } as unknown as GoogleOAuth;
}

describe("syncOtherContacts", () => {
	beforeEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});
	afterEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});

	it("writes name for each of a contact's emails, and persists the sync token", async () => {
		__setRequestUrl(() => ({
			status: 200,
			json: {
				otherContacts: [
					{
						names: [{ displayName: "Nicolas Ruflin" }],
						emailAddresses: [
							{ value: "Ruflin@Elastic.co" },
							{ value: "nick@elastic.co" },
						],
					},
				],
				nextSyncToken: "token-1",
			},
			text: "",
		}));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const result = await syncOtherContacts(fakeOauth(), cache);

		expect(result).toEqual({ updated: 2, full: true });
		expect(cache.getPerson("ruflin@elastic.co")).toEqual({
			name: "Nicolas Ruflin",
			at: 1_000,
		});
		expect(cache.getPerson("nick@elastic.co")?.name).toBe("Nicolas Ruflin");
		expect(cache.otherContactsSyncToken).toBe("token-1");
		expect(cache.otherContactsSyncedAt).toBe(1_000);
	});

	it("pages through nextPageToken and merges every page's entries", async () => {
		let call = 0;
		const seenUrls: string[] = [];
		__setRequestUrl((req: { url: string }) => {
			seenUrls.push(req.url);
			call++;
			if (call === 1) {
				return {
					status: 200,
					json: {
						otherContacts: [
							{
								names: [{ displayName: "Alice" }],
								emailAddresses: [{ value: "alice@x.com" }],
							},
						],
						nextPageToken: "page-2",
					},
					text: "",
				};
			}
			return {
				status: 200,
				json: {
					otherContacts: [
						{
							names: [{ displayName: "Bob" }],
							emailAddresses: [{ value: "bob@x.com" }],
						},
					],
					nextSyncToken: "final-token",
				},
				text: "",
			};
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const result = await syncOtherContacts(fakeOauth(), cache);

		expect(result.updated).toBe(2);
		expect(cache.getPerson("alice@x.com")?.name).toBe("Alice");
		expect(cache.getPerson("bob@x.com")?.name).toBe("Bob");
		expect(cache.otherContactsSyncToken).toBe("final-token");
		expect(call).toBe(2);
		expect(seenUrls[1]).toContain("pageToken=page-2");
	});

	it("sends syncToken only on the first request of an incremental sync", async () => {
		let call = 0;
		const seenUrls: string[] = [];
		__setRequestUrl((req: { url: string }) => {
			seenUrls.push(req.url);
			call++;
			if (call === 1) {
				return {
					status: 200,
					json: {
						otherContacts: [
							{
								names: [{ displayName: "Alice" }],
								emailAddresses: [{ value: "alice@x.com" }],
							},
						],
						nextPageToken: "page-2",
					},
					text: "",
				};
			}
			return {
				status: 200,
				json: { otherContacts: [], nextSyncToken: "token-2" },
				text: "",
			};
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.setOtherContactsSynced("token-1");
		const result = await syncOtherContacts(fakeOauth(), cache);

		expect(result.full).toBe(false);
		expect(seenUrls[0]).toContain("syncToken=token-1");
		expect(seenUrls[1]).not.toContain("syncToken=");
		expect(seenUrls[1]).toContain("pageToken=page-2");
	});

	it("skips deleted contacts", async () => {
		__setRequestUrl(() => ({
			status: 200,
			json: {
				otherContacts: [
					{
						metadata: { deleted: true },
						names: [{ displayName: "Gone" }],
						emailAddresses: [{ value: "gone@x.com" }],
					},
				],
			},
			text: "",
		}));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const result = await syncOtherContacts(fakeOauth(), cache);
		expect(result.updated).toBe(0);
		expect(cache.getPerson("gone@x.com")).toBeUndefined();
	});

	it("skips a contact with no name", async () => {
		__setRequestUrl(() => ({
			status: 200,
			json: {
				otherContacts: [{ emailAddresses: [{ value: "blank@x.com" }] }],
			},
			text: "",
		}));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const result = await syncOtherContacts(fakeOauth(), cache);
		expect(result.updated).toBe(0);
		expect(cache.getPerson("blank@x.com")).toBeUndefined();
	});

	it("clears the sync token on a 410 (expired) so the next sync does a full fetch", async () => {
		__setRequestUrl(() => ({ status: 410, json: {}, text: "gone" }));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.setOtherContactsSynced("stale-token");
		await syncOtherContacts(fakeOauth(), cache);
		expect(cache.otherContactsSyncToken).toBeNull();
	});

	it("marks the shared rate-limit cooldown on a 429 instead of throwing", async () => {
		__setRequestUrl(() => ({ status: 429, json: {}, text: "quota" }));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		await expect(syncOtherContacts(fakeOauth(), cache)).resolves.toEqual({
			updated: 0,
			full: true,
		});
		expect(cache.peopleIsRateLimited()).toBe(true);
	});

	it("soft-fails on a 403 instead of throwing", async () => {
		__setRequestUrl(() => ({ status: 403, json: {}, text: "forbidden" }));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		await expect(syncOtherContacts(fakeOauth(), cache)).resolves.toEqual({
			updated: 0,
			full: true,
		});
	});

	it("throws on an unexpected error status", async () => {
		__setRequestUrl(() => ({ status: 500, json: {}, text: "boom" }));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		await expect(syncOtherContacts(fakeOauth(), cache)).rejects.toThrow(
			/HTTP 500/
		);
	});
});
