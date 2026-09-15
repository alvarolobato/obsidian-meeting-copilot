import { describe, it, expect, vi } from "vitest";
import {
	DirectoryCache,
	GROUP_TTL_MS,
	PEOPLE_RATE_WINDOW_MS,
	PEOPLE_TTL_MS,
	PeopleApiRateLimiter,
	type DirectoryCacheStore,
} from "./directoryCache";

function memoryStore(initial: string | null = null): DirectoryCacheStore & {
	data: string | null;
} {
	const store = {
		data: initial,
		async read() {
			return store.data;
		},
		async write(json: string) {
			store.data = json;
		},
	};
	return store;
}

describe("DirectoryCache", () => {
	it("persists people and reloads fresh entries", async () => {
		const store = memoryStore();
		const now = vi.fn(() => 1_000_000);
		const cache = new DirectoryCache(store, now, 0);
		cache.setPerson("ruflin@elastic.co", "Nicolas Ruflin");
		await cache.flush();

		const loaded = new DirectoryCache(store, now, 0);
		await loaded.load();
		expect(loaded.getPerson("ruflin@elastic.co")).toEqual({
			name: "Nicolas Ruflin",
			at: 1_000_000,
		});
	});

	it("expires people after PEOPLE_TTL_MS", () => {
		let t = 1_000_000;
		const cache = new DirectoryCache(null, () => t, 0);
		cache.setPerson("a@x.com", "A");
		t += PEOPLE_TTL_MS + 1;
		expect(cache.getPerson("a@x.com")).toBeUndefined();
	});

	it("expires groups after GROUP_TTL_MS", () => {
		let t = 1_000_000;
		const cache = new DirectoryCache(null, () => t, 0);
		cache.setGroupLookup("elg@x.com", "groups/elg");
		cache.setGroupMembers("elg@x.com", "groups/elg", [
			{ email: "a@x.com", type: "USER" },
		]);
		expect(cache.getGroup("elg@x.com")?.members).toHaveLength(1);
		t += GROUP_TTL_MS + 1;
		expect(cache.getGroup("elg@x.com")).toBeUndefined();
	});

	it("skips stale entries on load", async () => {
		const store = memoryStore(
			JSON.stringify({
				version: 1,
				people: {
					"old@x.com": { name: "Old", at: 1 },
				},
				groups: {},
			})
		);
		const cache = new DirectoryCache(store, () => PEOPLE_TTL_MS + 100, 0);
		await cache.load();
		expect(cache.getPerson("old@x.com")).toBeUndefined();
	});

	it("tracks People rate-limit cooldown", () => {
		let t = 1_000;
		const cache = new DirectoryCache(null, () => t, 0);
		expect(cache.peopleIsRateLimited()).toBe(false);
		cache.markPeopleRateLimited(60_000);
		expect(cache.peopleIsRateLimited()).toBe(true);
		t += 60_001;
		expect(cache.peopleIsRateLimited()).toBe(false);
	});

	it("clearNegativeEntries drops miss entries but keeps hits", () => {
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.setPerson("hit@x.com", "Hit");
		cache.setPerson("miss@x.com", null);
		cache.setGroupLookup("group@x.com", "groups/g");
		cache.setGroupLookup("notgroup@x.com", null);
		cache.clearNegativeEntries();
		expect(cache.getPerson("hit@x.com")?.name).toBe("Hit");
		expect(cache.getPerson("miss@x.com")).toBeUndefined();
		expect(cache.getGroup("group@x.com")?.resource).toBe("groups/g");
		expect(cache.getGroup("notgroup@x.com")).toBeUndefined();
	});

	it("persists and reloads rate-limit timestamps", async () => {
		const store = memoryStore();
		const now = vi.fn(() => 1_000_000);
		const cache = new DirectoryCache(store, now, 0);
		cache.setPeopleRateLimitTimestamps([999_000, 999_500, 1_000_000]);
		await cache.flush();

		const loaded = new DirectoryCache(store, now, 0);
		await loaded.load();
		expect(loaded.peopleRateLimitTimestamps).toEqual([
			999_000, 999_500, 1_000_000,
		]);
	});

	it("prunes stale rate-limit timestamps on load", async () => {
		const store = memoryStore(
			JSON.stringify({
				version: 1,
				people: {},
				groups: {},
				rateLimitTimestamps: [0, 500_000, 990_000],
			})
		);
		// now = 1_000_000: only the last timestamp is within the last
		// PEOPLE_RATE_WINDOW_MS (60s).
		const cache = new DirectoryCache(store, () => 1_000_000, 0);
		await cache.load();
		expect(cache.peopleRateLimitTimestamps).toEqual([990_000]);
	});
});

describe("PeopleApiRateLimiter", () => {
	it("allows up to maxPerMinute then requires a wait", () => {
		let t = 0;
		const limiter = new PeopleApiRateLimiter(3, () => t);
		expect(limiter.waitMs()).toBe(0);
		limiter.record();
		t = 100;
		limiter.record();
		t = 200;
		limiter.record();
		t = 300;
		expect(limiter.waitMs()).toBeGreaterThan(0);
		t = 60_001;
		expect(limiter.waitMs()).toBe(0);
	});

	it("seeded with persisted timestamps, already counts toward the cap (a reload isn't a fresh 60/min)", () => {
		const t = 1_000_000;
		// Simulate a just-superseded instance having already made 3 of 3
		// allowed requests moments ago; a fresh limiter with no memory of
		// this would wrongly allow 3 more immediately.
		const limiter = new PeopleApiRateLimiter(
			3,
			() => t,
			[t - 100, t - 50, t - 10]
		);
		expect(limiter.waitMs()).toBeGreaterThan(0);
	});

	it("ignores seeded timestamps already outside the window", () => {
		const t = 1_000_000;
		const limiter = new PeopleApiRateLimiter(
			3,
			() => t,
			[t - PEOPLE_RATE_WINDOW_MS - 1]
		);
		expect(limiter.waitMs()).toBe(0);
	});

	it("reports the running timestamp list via onChange on every record", () => {
		const seen: number[][] = [];
		let t = 0;
		const limiter = new PeopleApiRateLimiter(5, () => t, [], (ts) =>
			seen.push(ts)
		);
		limiter.record();
		t = 10;
		limiter.record();
		expect(seen).toEqual([[0], [0, 10]]);
	});
});

describe("DirectoryCache bypass (dev console)", () => {
	it("hides cached people so the next lookup goes to the network", () => {
		const cache = new DirectoryCache(null, () => 1_000);
		cache.setPerson("colleague@acme.com", "Sophie Chen");

		expect(cache.getPerson("colleague@acme.com")?.name).toBe("Sophie Chen");
		cache.bypass = true;
		expect(cache.getPerson("colleague@acme.com")).toBeUndefined();
	});

	it("hides groups by email and by resource", () => {
		const cache = new DirectoryCache(null, () => 1_000);
		cache.setGroupMembers("team@acme.com", "groups/abc", [
			{ email: "raj@acme.com", type: "USER" },
		]);

		expect(cache.getGroup("team@acme.com")).toBeDefined();
		expect(cache.getGroupByResource("groups/abc")).toBeDefined();

		cache.bypass = true;
		expect(cache.getGroup("team@acme.com")).toBeUndefined();
		expect(cache.getGroupByResource("groups/abc")).toBeUndefined();
	});

	it("only hides reads, so turning it off restores the warm cache", () => {
		const cache = new DirectoryCache(null, () => 1_000);
		cache.bypass = true;
		cache.setPerson("colleague@acme.com", "Sophie Chen");
		expect(cache.getPerson("colleague@acme.com")).toBeUndefined();

		cache.bypass = false;
		expect(cache.getPerson("colleague@acme.com")?.name).toBe("Sophie Chen");
	});

	it("does not persist — a cache loaded from disk starts unbypassed", async () => {
		const store = memoryStore();
		const write = new DirectoryCache(store, () => 1_000, 0);
		write.bypass = true;
		write.setPerson("colleague@acme.com", "Sophie Chen");
		await write.flush();

		const read = new DirectoryCache(store, () => 1_000, 0);
		await read.load();
		expect(read.bypass).toBe(false);
		expect(read.getPerson("colleague@acme.com")?.name).toBe("Sophie Chen");
	});
});

describe("DirectoryCache.clearAll", () => {
	it("empties both maps", () => {
		const cache = new DirectoryCache(null, () => 5_000);
		cache.setPerson("colleague@acme.com", "Sophie Chen");
		cache.setGroupMembers("team@acme.com", "groups/abc", []);

		cache.clearAll();

		expect(cache.people.size).toBe(0);
		expect(cache.groups.size).toBe(0);
	});
});
