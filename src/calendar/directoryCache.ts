import type { GroupMember } from "./expandGroupAttendees";

/** People display-name TTL — effectively permanent; constant kept for hygiene. */
export const PEOPLE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** Group membership / lookup TTL. */
export const GROUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Cap People API calls below Google's 90/min per-user quota so a busy agenda
 * expand can't 429 itself. Groups lookups are cheaper and uncapped here.
 */
export const PEOPLE_MAX_REQUESTS_PER_MINUTE = 60;
/** The People API quota's rolling window; shared by {@link PeopleApiRateLimiter}
 * and the persisted timestamps below so both prune on the same boundary. */
export const PEOPLE_RATE_WINDOW_MS = 60_000;
/** Debounce disk writes after a burst of cache fills. */
export const DIRECTORY_CACHE_SAVE_DEBOUNCE_MS = 1500;
export const DIRECTORY_CACHE_FILENAME = "directory-cache.json";
/**
 * Only bump this for a breaking shape change — a version bump discards every
 * cached entry on next load, and since names are cached ~365 days, that
 * forces every still-cached person to be looked up again in one burst, which
 * has blown through the People API's 90/min quota (429s) before. Prefer an
 * additive field over a bump when possible.
 */
export const DIRECTORY_CACHE_VERSION = 1;

export interface CachedPerson {
	/** Directory display name, or `null` when looked up and not found. */
	name: string | null;
	/** Epoch ms when cached. */
	at: number;
}

export interface CachedGroup {
	/** Cloud Identity resource (`groups/…`), or `null` when not a group. */
	resource: string | null;
	/** Members when `resource` is set; omitted for non-groups. */
	members?: GroupMember[];
	at: number;
}

export interface DirectoryCacheFile {
	version: number;
	people: Record<string, CachedPerson>;
	groups: Record<string, CachedGroup>;
	/**
	 * Epoch-ms timestamps of recent People API requests (see
	 * {@link PeopleApiRateLimiter}), so a fresh plugin instance (a reload, not
	 * a new day) knows how much of Google's real, server-side 60s quota
	 * window is already spent instead of starting its local count at zero —
	 * two reloads within the same minute previously could each believe they
	 * were under the local cap while cumulatively exceeding Google's actual
	 * 90/min. Optional/omittable: absent on old cache files, and irrelevant
	 * once pruned to empty.
	 */
	rateLimitTimestamps?: number[];
}

export interface DirectoryCacheStore {
	read(): Promise<string | null>;
	write(json: string): Promise<void>;
}

function normEmail(email: string): string {
	return email.trim().toLowerCase();
}

function isFresh(at: number, ttlMs: number, now: number): boolean {
	return now - at < ttlMs;
}

/**
 * Persistent People/Groups directory cache (plugin-dir JSON). Pure logic is
 * unit-testable; I/O goes through {@link DirectoryCacheStore}.
 */
export class DirectoryCache {
	people = new Map<string, CachedPerson>();
	groups = new Map<string, CachedGroup>();
	private dirty = false;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	/** When set, People network calls should wait (429 / soft rate limit). */
	peopleRateLimitedUntil = 0;
	/** Recent People API request timestamps; seeds a fresh {@link PeopleApiRateLimiter}
	 * after a reload. Pruned to {@link PEOPLE_RATE_WINDOW_MS} on load. */
	peopleRateLimitTimestamps: number[] = [];

	constructor(
		private readonly store: DirectoryCacheStore | null,
		private readonly now: () => number = () => Date.now(),
		private readonly saveDebounceMs = DIRECTORY_CACHE_SAVE_DEBOUNCE_MS
	) {}

	async load(): Promise<void> {
		if (!this.store) return;
		try {
			const raw = await this.store.read();
			if (!raw) return;
			const parsed = JSON.parse(raw) as DirectoryCacheFile;
			if (parsed?.version !== DIRECTORY_CACHE_VERSION) return;
			const now = this.now();
			for (const [email, entry] of Object.entries(parsed.people ?? {})) {
				if (
					entry &&
					typeof entry.at === "number" &&
					isFresh(entry.at, PEOPLE_TTL_MS, now)
				) {
					this.people.set(normEmail(email), {
						name: entry.name,
						at: entry.at,
					});
				}
			}
			for (const [email, entry] of Object.entries(parsed.groups ?? {})) {
				if (
					entry &&
					typeof entry.at === "number" &&
					isFresh(entry.at, GROUP_TTL_MS, now)
				) {
					this.groups.set(normEmail(email), {
						resource: entry.resource,
						members: entry.members,
						at: entry.at,
					});
				}
			}
			this.peopleRateLimitTimestamps = (parsed.rateLimitTimestamps ?? []).filter(
				(t) => typeof t === "number" && isFresh(t, PEOPLE_RATE_WINDOW_MS, now)
			);
		} catch (err) {
			console.warn(
				"[Meeting Copilot] Failed to load directory cache; starting empty.",
				err
			);
		}
	}

	getPerson(email: string): CachedPerson | undefined {
		const key = normEmail(email);
		const entry = this.people.get(key);
		if (!entry) return undefined;
		if (!isFresh(entry.at, PEOPLE_TTL_MS, this.now())) {
			this.people.delete(key);
			this.markDirty();
			return undefined;
		}
		return entry;
	}

	setPerson(email: string, name: string | null): void {
		this.people.set(normEmail(email), { name, at: this.now() });
		this.markDirty();
	}

	getGroup(email: string): CachedGroup | undefined {
		const key = normEmail(email);
		const entry = this.groups.get(key);
		if (!entry) return undefined;
		if (!isFresh(entry.at, GROUP_TTL_MS, this.now())) {
			this.groups.delete(key);
			this.markDirty();
			return undefined;
		}
		return entry;
	}

	setGroupLookup(email: string, resource: string | null): void {
		const key = normEmail(email);
		const prev = this.groups.get(key);
		this.groups.set(key, {
			resource,
			members: resource ? prev?.members : undefined,
			at: this.now(),
		});
		this.markDirty();
	}

	setGroupMembers(email: string, resource: string, members: GroupMember[]): void {
		this.groups.set(normEmail(email), {
			resource,
			members,
			at: this.now(),
		});
		this.markDirty();
	}

	/** Find a cached group entry by Cloud Identity resource name. */
	getGroupByResource(resource: string): CachedGroup | undefined {
		const now = this.now();
		for (const entry of this.groups.values()) {
			if (entry.resource !== resource) continue;
			if (!isFresh(entry.at, GROUP_TTL_MS, now)) continue;
			if (entry.members) return entry;
		}
		return undefined;
	}

	setGroupMembersByResource(resource: string, members: GroupMember[]): void {
		const now = this.now();
		let updated = false;
		for (const [email, entry] of this.groups) {
			if (entry.resource !== resource) continue;
			this.groups.set(email, { ...entry, members, at: now });
			updated = true;
		}
		if (!updated) {
			// Orphan resource cache keyed by the resource string itself.
			this.groups.set(resource.toLowerCase(), {
				resource,
				members,
				at: now,
			});
		}
		this.markDirty();
	}

	/** Drop negative (miss) entries so a re-auth can retry lookups. */
	clearNegativeEntries(): void {
		let changed = false;
		for (const [email, entry] of this.people) {
			if (entry.name === null) {
				this.people.delete(email);
				changed = true;
			}
		}
		for (const [email, entry] of this.groups) {
			if (entry.resource === null) {
				this.groups.delete(email);
				changed = true;
			}
		}
		if (changed) this.markDirty();
	}

	peopleIsRateLimited(): boolean {
		return this.now() < this.peopleRateLimitedUntil;
	}

	markPeopleRateLimited(cooldownMs = 60_000): void {
		this.peopleRateLimitedUntil = this.now() + cooldownMs;
	}

	/** Called by {@link PeopleApiRateLimiter} on every recorded request so its
	 * state survives a plugin reload — see {@link DirectoryCacheFile.rateLimitTimestamps}. */
	setPeopleRateLimitTimestamps(timestamps: number[]): void {
		this.peopleRateLimitTimestamps = timestamps;
		this.markDirty();
	}


	toJSON(): DirectoryCacheFile {
		const now = this.now();
		const people: Record<string, CachedPerson> = {};
		for (const [email, entry] of this.people) {
			if (isFresh(entry.at, PEOPLE_TTL_MS, now)) people[email] = entry;
		}
		const groups: Record<string, CachedGroup> = {};
		for (const [email, entry] of this.groups) {
			if (isFresh(entry.at, GROUP_TTL_MS, now)) groups[email] = entry;
		}
		const rateLimitTimestamps = this.peopleRateLimitTimestamps.filter((t) =>
			isFresh(t, PEOPLE_RATE_WINDOW_MS, now)
		);
		return {
			version: DIRECTORY_CACHE_VERSION,
			people,
			groups,
			rateLimitTimestamps,
		};
	}

	private markDirty(): void {
		this.dirty = true;
		this.scheduleSave();
	}

	private scheduleSave(): void {
		if (!this.store || this.saveTimer !== null) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.flush();
		}, this.saveDebounceMs);
	}

	/** Flush pending writes immediately (e.g. on unload). */
	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		if (!this.dirty || !this.store) return;
		this.dirty = false;
		try {
			await this.store.write(JSON.stringify(this.toJSON()));
		} catch (err) {
			this.dirty = true;
			console.warn(
				"[Meeting Copilot] Failed to save directory cache.",
				err
			);
		}
	}
}

/**
 * Sliding-window limiter for People API calls. Returns how many ms to wait
 * before the next call is allowed (0 = go now).
 *
 * Seedable with `initialTimestamps` and an `onChange` callback so its state
 * can survive a plugin reload: Google's quota window is real-world-clock,
 * server-side, and doesn't reset just because our process restarted, so a
 * fresh limiter starting its local count at zero could believe it's under
 * the local cap while a just-superseded instance already spent most of the
 * same real 60s window — two reloads within a minute could cumulatively
 * exceed Google's actual 90/min even though each stayed under our 60/min
 * locally. See {@link DirectoryCacheFile.rateLimitTimestamps}.
 */
export class PeopleApiRateLimiter {
	private timestamps: number[];

	constructor(
		private readonly maxPerMinute = PEOPLE_MAX_REQUESTS_PER_MINUTE,
		private readonly now: () => number = () => Date.now(),
		initialTimestamps: number[] = [],
		private readonly onChange?: (timestamps: number[]) => void
	) {
		this.timestamps = [...initialTimestamps];
		this.prune(this.now());
	}

	/** Record a request that is about to go out. */
	record(): void {
		const now = this.now();
		this.prune(now);
		this.timestamps.push(now);
		this.onChange?.(this.timestamps.slice());
	}

	/** Ms until a slot frees, or 0 if under the cap. */
	waitMs(): number {
		const now = this.now();
		this.prune(now);
		if (this.timestamps.length < this.maxPerMinute) return 0;
		const oldest = this.timestamps[0]!;
		return Math.max(0, PEOPLE_RATE_WINDOW_MS - (now - oldest) + 1);
	}

	private prune(now: number): void {
		const cutoff = now - PEOPLE_RATE_WINDOW_MS;
		while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
			this.timestamps.shift();
		}
	}
}

export async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}
