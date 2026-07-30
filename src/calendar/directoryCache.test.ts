import { describe, it, expect, vi } from "vitest";
import {
	AVATAR_COLOR_PALETTE,
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
			photoUrl: null,
			at: 1_000_000,
		});
	});

	it("persists and reloads a photo URL alongside the name", async () => {
		const store = memoryStore();
		const now = vi.fn(() => 1_000_000);
		const cache = new DirectoryCache(store, now, 0);
		cache.setPerson(
			"ruflin@elastic.co",
			"Nicolas Ruflin",
			"https://lh3.googleusercontent.com/a/photo"
		);
		await cache.flush();

		const loaded = new DirectoryCache(store, now, 0);
		await loaded.load();
		expect(loaded.getPerson("ruflin@elastic.co")).toEqual({
			name: "Nicolas Ruflin",
			photoUrl: "https://lh3.googleusercontent.com/a/photo",
			at: 1_000_000,
		});
	});

	it("loads a pre-photo cache entry (missing photoUrl) without discarding it", async () => {
		// Must NOT be invalidated by a version bump: a photo-less entry here
		// means the name is still cached and doesn't need re-fetching (only
		// the photo backfills lazily on next lookup). See DIRECTORY_CACHE_VERSION.
		const store = memoryStore(
			JSON.stringify({
				version: 1,
				people: { "old@x.com": { name: "Old", at: 1_000_000 } },
				groups: {},
			})
		);
		const cache = new DirectoryCache(store, () => 1_000_000, 0);
		await cache.load();
		expect(cache.getPerson("old@x.com")).toEqual({
			name: "Old",
			photoUrl: null,
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
					"old@x.com": { name: "Old", photoUrl: null, at: 1 },
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

	it("clearNegativeEntries keeps a null-name entry that has a real photo", () => {
		// A directory hit can return a photo with no name field — that's a
		// hit, not a miss, and shouldn't be discarded on re-auth.
		const cache = new DirectoryCache(null, () => 1_000, 0);
		cache.setPerson("photo-only@x.com", null, "https://example.com/p.png");
		cache.clearNegativeEntries();
		expect(cache.getPerson("photo-only@x.com")).toEqual({
			name: null,
			photoUrl: "https://example.com/p.png",
			at: 1_000,
		});
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

	it("getOrAssignAvatarColor picks once and then stays stable across calls", () => {
		const cache = new DirectoryCache(null, () => 1_000, 0);
		let calls = 0;
		const random = () => {
			calls++;
			return 0; // always the first palette entry
		};
		const first = cache.getOrAssignAvatarColor(
			"Ruflin@Elastic.co",
			AVATAR_COLOR_PALETTE,
			random
		);
		expect(first).toBe(AVATAR_COLOR_PALETTE[0]);
		expect(calls).toBe(1);

		// Same person (any casing) again: no re-roll, same color.
		const second = cache.getOrAssignAvatarColor(
			"ruflin@elastic.co",
			AVATAR_COLOR_PALETTE,
			random
		);
		expect(second).toBe(first);
		expect(calls).toBe(1);
	});

	it("assigns independent colors to different people", () => {
		const cache = new DirectoryCache(null, () => 1_000, 0);
		let n = 0;
		// Deterministically walk the palette: 0, 1, 2, ...
		const random = () => {
			const v = n / AVATAR_COLOR_PALETTE.length;
			n++;
			return v;
		};
		const a = cache.getOrAssignAvatarColor("a@x.com", AVATAR_COLOR_PALETTE, random);
		const b = cache.getOrAssignAvatarColor("b@x.com", AVATAR_COLOR_PALETTE, random);
		expect(a).toBe(AVATAR_COLOR_PALETTE[0]);
		expect(b).toBe(AVATAR_COLOR_PALETTE[1]);
	});

	it("persists and reloads avatar colors", async () => {
		const store = memoryStore();
		const now = vi.fn(() => 1_000);
		const cache = new DirectoryCache(store, now, 0);
		const color = cache.getOrAssignAvatarColor("ruflin@elastic.co", AVATAR_COLOR_PALETTE, () => 0);
		await cache.flush();

		const loaded = new DirectoryCache(store, now, 0);
		await loaded.load();
		expect(loaded.getOrAssignAvatarColor("ruflin@elastic.co")).toBe(color);
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
