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

describe("resolveAttendeeLabel", () => {
	it("prefers Calendar displayName over directory", async () => {
		const resolveDisplayName = vi.fn(async () => "Directory Name");
		const people: PersonDirectory = { resolveDisplayName };
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", "Nicolas Ruflin", people)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).not.toHaveBeenCalled();
	});

	it("uses People directory when Calendar has no displayName", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => "Nicolas Ruflin",
		};
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people)
		).resolves.toBe("Nicolas Ruflin");
	});

	it("falls back to humanized local-part when directory misses", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => null,
		};
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", "", people)
		).resolves.toBe("Ruflin");
	});

	it("caches directory hits and skips re-lookup", async () => {
		const resolveDisplayName = vi
			.fn()
			.mockResolvedValueOnce("Nicolas Ruflin");
		const people: PersonDirectory = { resolveDisplayName };
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

	it("still calls the directory once disabled — the directory's own lookup, not this early-return, is what skips the network", async () => {
		// A real PersonDirectory (via createPeopleDirectory) short-circuits a
		// disabled directory to a cheap cache check, not a network call — so
		// resolveAttendeeLabel must not gate on `cache.disabled` itself, or an
		// an already-cached person would never be resolved again
		// this session once the directory API had failed once for anyone.
		const resolveDisplayName = vi.fn(async () => "Should Still Be Called");
		const people: PersonDirectory = { resolveDisplayName };
		const cache = new PersonNameCache();
		cache.disabled = true;
		await expect(
			resolveAttendeeLabel("someone@elastic.co", "", people, cache)
		).resolves.toBe("Should Still Be Called");
		expect(resolveDisplayName).toHaveBeenCalledTimes(1);
	});

	it("does not session-cache inconclusive (undefined) directory results", async () => {
		const resolveDisplayName = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce("Nicolas Ruflin");
		const people: PersonDirectory = { resolveDisplayName };
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

	it("logs directory hard-fail once per session cache", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const people: PersonDirectory = {
			resolveDisplayName: async () => {
				throw new Error("People API disabled");
			},
		};
		const cache = new PersonNameCache();
		await resolveAttendeeLabel("a@x.com", "", people, cache);
		await resolveAttendeeLabel("b@x.com", "", people, cache);
		expect(
			warn.mock.calls.filter((c) =>
				String(c[0]).includes("People directory name lookup failed")
			)
		).toHaveLength(1);
		warn.mockRestore();
	});
});

describe("createPeopleDirectory", () => {
	beforeEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});
	afterEach(() => {
		__setRequestUrl(() => ({ status: 200, json: {}, text: "" }));
	});

	it("requests only names/emails in the readMask", async () => {
		let requestedUrl = "";
		__setRequestUrl((req: { url: string }) => {
			requestedUrl = req.url;
			return { status: 200, json: { people: [] }, text: "" };
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await people.resolveDisplayName("ruflin@elastic.co");
		expect(requestedUrl).toContain(
			encodeURIComponent("names,emailAddresses")
		);
		expect(requestedUrl).not.toContain("photos");
	});

	it("caches a confirmed miss (404) as no name", async () => {
		__setRequestUrl(() => ({ status: 404, json: {}, text: "not found" }));
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
		});
		await expect(
			people.resolveDisplayName("ghost@elastic.co")
		).resolves.toBeNull();
		expect(cache.getPerson("ghost@elastic.co")).toEqual({
			name: null,
			at: 1_000,
		});
	});

	it("stays quiet about a cooldown skip unless debugLogging is on", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.markPeopleRateLimited(60_000);

		const quiet = createPeopleDirectory(fakeOauth(), { directoryCache: cache });
		await quiet.resolveDisplayName("ruflin@elastic.co");
		expect(warnSpy).not.toHaveBeenCalled();

		const verbose = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			debugLogging: true,
		});
		await verbose.resolveDisplayName("ruflin@elastic.co");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("people lookup skipped (cooldown active)")
		);
		warnSpy.mockRestore();
	});

	it("still resolves a directory-cache hit once nameCache.disabled is set", async () => {
		let networkCalls = 0;
		__setRequestUrl(() => {
			networkCalls++;
			return { status: 200, json: { people: [] }, text: "" };
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		// Simulate this person having already been resolved via a
		// completely different (unblocked) API.
		cache.setPerson("ruflin@elastic.co", "Nicolas Ruflin");
		const nameCache = new PersonNameCache();
		nameCache.disabled = true; // e.g. Workspace policy blocked the directory earlier this session
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			nameCache,
		});

		await expect(
			people.resolveDisplayName("ruflin@elastic.co")
		).resolves.toBe("Nicolas Ruflin");
		expect(networkCalls).toBe(0);
	});

	it("skips the network call (no cache hit, disabled) without throwing", async () => {
		let networkCalls = 0;
		__setRequestUrl(() => {
			networkCalls++;
			return { status: 403, json: {}, text: "forbidden" };
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const nameCache = new PersonNameCache();
		nameCache.disabled = true;
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			nameCache,
		});

		await expect(
			people.resolveDisplayName("nobody@elastic.co")
		).resolves.toBeUndefined();
		expect(networkCalls).toBe(0);
	});

	it("skips the network call when enabled:false (the directory.readonly scope toggled off in settings)", async () => {
		let networkCalls = 0;
		__setRequestUrl(() => {
			networkCalls++;
			return { status: 200, json: { people: [] }, text: "" };
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			enabled: false,
		});

		await expect(
			people.resolveDisplayName("nobody@elastic.co")
		).resolves.toBeUndefined();
		expect(networkCalls).toBe(0);
	});

	it("still resolves a directoryCache hit even when enabled:false", async () => {
		let networkCalls = 0;
		__setRequestUrl(() => {
			networkCalls++;
			return { status: 200, json: { people: [] }, text: "" };
		});
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.setPerson("ruflin@elastic.co", "Nicolas Ruflin");
		const people = createPeopleDirectory(fakeOauth(), {
			directoryCache: cache,
			enabled: false,
		});

		await expect(
			people.resolveDisplayName("ruflin@elastic.co")
		).resolves.toBe("Nicolas Ruflin");
		expect(networkCalls).toBe(0);
	});
});
