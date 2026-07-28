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
/** Debounce disk writes after a burst of cache fills. */
export const DIRECTORY_CACHE_SAVE_DEBOUNCE_MS = 1500;
export const DIRECTORY_CACHE_FILENAME = "directory-cache.json";
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
		return { version: DIRECTORY_CACHE_VERSION, people, groups };
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
 */
export class PeopleApiRateLimiter {
	private timestamps: number[] = [];

	constructor(
		private readonly maxPerMinute = PEOPLE_MAX_REQUESTS_PER_MINUTE,
		private readonly now: () => number = () => Date.now()
	) {}

	/** Record a request that is about to go out. */
	record(): void {
		const now = this.now();
		this.prune(now);
		this.timestamps.push(now);
	}

	/** Ms until a slot frees, or 0 if under the cap. */
	waitMs(): number {
		const now = this.now();
		this.prune(now);
		if (this.timestamps.length < this.maxPerMinute) return 0;
		const oldest = this.timestamps[0]!;
		return Math.max(0, 60_000 - (now - oldest) + 1);
	}

	private prune(now: number): void {
		const cutoff = now - 60_000;
		while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
			this.timestamps.shift();
		}
	}
}

export async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return;
	await new Promise((resolve) => setTimeout(resolve, ms));
}
