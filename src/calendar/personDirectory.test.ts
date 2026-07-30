import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __setRequestUrl } from "../../test/obsidian-mock";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { DirectoryCache } from "./directoryCache";
import {
	PersonNameCache,
	createPeopleDirectory,
	resolveAttendeeLabel,
	type PersonDirectory,
} from "./personDirectory";

function fakeOauth(): GoogleOAuth {
	return { getAccessToken: async () => "tok" } as unknown as GoogleOAuth;
}

/** `resolveAttendeeLabel` only exercises `resolveDisplayName`; every mock
 * still has to satisfy the full interface. */
function noPhoto(): Pick<PersonDirectory, "resolvePhotoUrl"> {
	return { resolvePhotoUrl: async () => null };
}

describe("resolveAttendeeLabel", () => {
	it("prefers Calendar displayName over directory", async () => {
		const resolveDisplayName = vi.fn(async () => "Directory Name");
		const people: PersonDirectory = { resolveDisplayName, ...noPhoto() };
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", "Nicolas Ruflin", people)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).not.toHaveBeenCalled();
	});

	it("uses People directory when Calendar has no displayName", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => "Nicolas Ruflin",
			...noPhoto(),
		};
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people)
		).resolves.toBe("Nicolas Ruflin");
	});

	it("falls back to humanized local-part when directory misses", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => null,
			...noPhoto(),
		};
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", "", people)
		).resolves.toBe("Ruflin");
	});

	it("caches directory hits and skips re-lookup", async () => {
		const resolveDisplayName = vi
			.fn()
			.mockResolvedValueOnce("Nicolas Ruflin");
		const people: PersonDirectory = { resolveDisplayName, ...noPhoto() };
		const cache = new PersonNameCache();
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Nicolas Ruflin");
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).toHaveBeenCalledTimes(1);
	});

	it("soft-fails to humanized names when directory throws", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => {
				throw new Error("People API disabled");
			},
			...noPhoto(),
		};
		const cache = new PersonNameCache();
		await expect(
			resolveAttendeeLabel("ashutosh.kulkarni@elastic.co", "", people, cache)
		).resolves.toBe("Ashutosh Kulkarni");
		expect(cache.disabled).toBe(true);
		await expect(
			resolveAttendeeLabel("other@elastic.co", "", people, cache)
		).resolves.toBe("Other");
	});

	it("does not session-cache inconclusive (undefined) directory results", async () => {
		const resolveDisplayName = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce("Nicolas Ruflin");
		const people: PersonDirectory = { resolveDisplayName, ...noPhoto() };
		const cache = new PersonNameCache();
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Ruflin");
		expect(cache.miss.has("ruflin@elastic.co")).toBe(false);
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).toHaveBeenCalledTimes(2);
	});
});

describe("createPeopleDirectory", () => {
	beforeEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});
	afterEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});

	it("requests photos in the readMask alongside names/emails", async () => {
		let requestedUrl = "";
		__setRequestUrl((req: { url: string }) => {
			requestedUrl = req.url;
			return { status: 200, json: { people: [] }, text: "" };
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await people.resolvePhotoUrl("ruflin@elastic.co");
		expect(requestedUrl).toContain(
			encodeURIComponent("names,emailAddresses,photos")
		);
	});

	it("resolves a real photo, skipping Google's default silhouette", async () => {
		__setRequestUrl(() => ({
			status: 200,
			json: {
				people: [
					{
						names: [{ displayName: "Nicolas Ruflin" }],
						emailAddresses: [{ value: "ruflin@elastic.co" }],
						photos: [
							{ url: "https://example.com/default.png", default: true },
							{ url: "https://example.com/real.png", default: false },
						],
					},
				],
			},
			text: "",
		}));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await expect(
			people.resolvePhotoUrl("ruflin@elastic.co")
		).resolves.toBe("https://example.com/real.png");
	});

	it("shares one lookup/cache entry between name and photo resolution", async () => {
		let calls = 0;
		__setRequestUrl(() => {
			calls++;
			return {
				status: 200,
				json: {
					people: [
						{
							names: [{ displayName: "Nicolas Ruflin" }],
							emailAddresses: [{ value: "ruflin@elastic.co" }],
							photos: [{ url: "https://example.com/real.png" }],
						},
					],
				},
				text: "",
			};
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await expect(
			people.resolveDisplayName("ruflin@elastic.co")
		).resolves.toBe("Nicolas Ruflin");
		await expect(
			people.resolvePhotoUrl("ruflin@elastic.co")
		).resolves.toBe("https://example.com/real.png");
		expect(calls).toBe(1);
	});

	it("caches a confirmed miss (404) as no name and no photo", async () => {
		__setRequestUrl(() => ({ status: 404, json: {}, text: "not found" }));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await expect(
			people.resolvePhotoUrl("ghost@elastic.co")
		).resolves.toBeNull();
		expect(cache.getPerson("ghost@elastic.co")).toEqual({
			name: null,
			photoUrl: null,
			at: 1_000,
		});
	});

	it("stays quiet about a cooldown skip unless debugLogging is on", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.markPeopleRateLimited(60_000);

		const quiet = createPeopleDirectory(fakeOauth(), { directoryCache: cache });
		await quiet.resolvePhotoUrl("ruflin@elastic.co");
		expect(warnSpy).not.toHaveBeenCalled();

		const verbose = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			debugLogging: true,
		});
		await verbose.resolvePhotoUrl("ruflin@elastic.co");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("people lookup skipped (cooldown active)")
		);
		warnSpy.mockRestore();
	});
});
