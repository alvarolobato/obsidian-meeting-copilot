import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { humanizeEmailName } from "./attendeeNames";
import {
	DirectoryCache,
	PeopleApiRateLimiter,
	sleep,
} from "./directoryCache";
import { mcLog } from "../util/logLine";

const PEOPLE_API = "https://people.googleapis.com/v1";

/**
 * Workspace directory lookups for display names and photos. Non-admin People
 * API (`directory.readonly`) — not Admin SDK Directory.
 */
export interface PersonDirectory {
	/**
	 * Resolve a workspace user's display name from their email.
	 * - `string` — directory hit
	 * - `null` — confirmed miss (safe to session-cache)
	 * - `undefined` — inconclusive (e.g. 403); do not session-cache as a miss
	 */
	resolveDisplayName(email: string): Promise<string | null | undefined>;
	/**
	 * Resolve a workspace user's directory photo URL from their email. Same
	 * hit/miss/inconclusive shape as {@link resolveDisplayName}, and backed by
	 * the same directory lookup/cache entry — resolving one after the other
	 * for the same email costs a single network call, not two.
	 */
	resolvePhotoUrl(email: string): Promise<string | null | undefined>;
}

/** Session cache shared across attendee-name resolutions. */
export class PersonNameCache {
	/** Successful directory hits. */
	names = new Map<string, string>();
	/** Emails looked up with no usable name (avoid re-hitting). */
	miss = new Set<string>();
	/** Set when People API is disabled / hard-fails — skip further network. */
	disabled = false;
}

function normEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Pick the best attendee label: Calendar displayName → directory name →
 * humanized local-part → raw email.
 */
export async function resolveAttendeeLabel(
	email: string,
	displayFromInvite: string | undefined,
	people: PersonDirectory | null,
	cache: PersonNameCache = new PersonNameCache()
): Promise<string> {
	const display = (displayFromInvite ?? "").trim();
	if (display) return display;

	const key = normEmail(email);
	if (!key.includes("@")) return email.trim() || email;

	const cached = cache.names.get(key);
	if (cached) return cached;
	if (cache.miss.has(key) || !people) {
		return humanizeEmailName(key) || key;
	}
	// Note: `cache.disabled` is intentionally *not* an early-return gate here.
	// `people.resolveDisplayName` (via its own `nameCache` option, the same
	// `cache` instance) already skips the network call once disabled — but
	// only after checking the persistent directory cache, so a hit from
	// otherContactsSync (a separate, unblocked API) still resolves. Gating
	// here too would skip that cache check entirely.

	try {
		const name = await people.resolveDisplayName(key);
		if (name) {
			cache.names.set(key, name);
			return name;
		}
		// Confirmed miss only — undefined means inconclusive (403), so retry later.
		if (name === null) cache.miss.add(key);
	} catch (err) {
		cache.disabled = true;
		console.warn(
			"[Meeting Copilot] People directory name lookup failed; falling back to humanized emails.",
			err
		);
	}
	return humanizeEmailName(key) || key;
}

export interface PeopleDirectoryOptions {
	/** Persistent people/groups cache (plugin-dir JSON). */
	directoryCache?: DirectoryCache;
	/** Caps People calls under the 90/min quota. */
	rateLimiter?: PeopleApiRateLimiter;
	/**
	 * Gates the per-lookup rate-limit-wait/cooldown-skip logs (one per
	 * attendee/organizer per poll — the same "verbose, off by default"
	 * category as the transcription pipeline's `debugLogging`). The 429 event
	 * itself and the higher-level avatar-resolve summary logs stay always-on.
	 */
	debugLogging?: boolean;
	/**
	 * When `.disabled` is true (set after a permanent-for-this-session
	 * failure — a Workspace policy block or SERVICE_DISABLED), skip the
	 * *network* searchDirectoryPeople call, but only after already checking
	 * `directoryCache` — a cache hit (e.g. from `otherContactsSync`, which
	 * keeps writing into the same cache on its own schedule) still resolves,
	 * since that's a completely different, unblocked API. Without this
	 * split, disabling the directory network path also silently stopped
	 * otherContacts-covered people from ever being looked up again this
	 * session.
	 */
	nameCache?: PersonNameCache;
}

export interface RawDirectoryPerson {
	names?: Array<{ displayName?: string; unstructuredName?: string }>;
	emailAddresses?: Array<{ value?: string }>;
	/** Present when `photos` is in the readMask; `default` marks Google's
	 * generic silhouette placeholder rather than a real uploaded photo. */
	photos?: Array<{ url?: string; default?: boolean }>;
}

/** A resolved (or confirmed-miss) directory entry: name and photo together,
 * since one `searchDirectoryPeople` call returns both. */
interface DirectoryLookup {
	name: string | null;
	photoUrl: string | null;
}

/** Shared with `otherContactsSync.ts`: both parse the same People API
 * `Person` resource shape (`names`/`emailAddresses`/`photos`). */
export function pickRealPhotoUrl(
	photos: RawDirectoryPerson["photos"]
): string | null {
	const real = (photos ?? []).find((p) => !p.default && p.url);
	return real?.url ?? null;
}

/**
 * Live People API client (searchDirectoryPeople) backed by the plugin's OAuth.
 * Honors {@link DirectoryCache} + {@link PeopleApiRateLimiter} when provided.
 * Name and photo share one lookup/cache entry per email, so resolving both
 * for the same person costs a single network call.
 */
export function createPeopleDirectory(
	oauth: GoogleOAuth,
	opts: PeopleDirectoryOptions = {}
): PersonDirectory {
	const { directoryCache, rateLimiter, debugLogging, nameCache } = opts;

	async function lookup(email: string): Promise<DirectoryLookup | undefined> {
		const key = normEmail(email);
		const cached = directoryCache?.getPerson(key);
		if (cached !== undefined) {
			return { name: cached.name, photoUrl: cached.photoUrl };
		}
		// Confirmed-permanent Directory block (e.g. Workspace policy): the
		// cache check above already ran, so this only skips the network call
		// that's certain to fail the same way — not otherContacts-sourced hits.
		if (nameCache?.disabled) return undefined;

		if (directoryCache?.peopleIsRateLimited()) {
			if (debugLogging) {
				mcLog("directory", "people lookup skipped (cooldown active)", {
					email: key,
				});
			}
			return undefined;
		}

		if (rateLimiter) {
			const wait = rateLimiter.waitMs();
			if (wait > 0) {
				if (debugLogging) {
					mcLog("directory", "people lookup waiting for rate-limit slot", {
						email: key,
						waitMs: wait,
					});
				}
				await sleep(wait);
			}
			rateLimiter.record();
		}

		const token = await oauth.getAccessToken();
		const url =
			`${PEOPLE_API}/people:searchDirectoryPeople` +
			`?query=${encodeURIComponent(email)}` +
			`&readMask=${encodeURIComponent("names,emailAddresses,photos")}` +
			`&pageSize=10` +
			`&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE` +
			`&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT`;
		const res = await requestUrl({
			url,
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			throw: false,
		});
		if (res.status === 429) {
			directoryCache?.markPeopleRateLimited(60_000);
			mcLog("directory", "people lookup 429 — quota exceeded, 60s cooldown", {
				email: key,
				body: res.text,
			});
			throw new Error(
				`People API searchDirectoryPeople HTTP 429: ${res.text}`
			);
		}
		if (res.status === 403) {
			const body =
				typeof res.json === "object" && res.json
					? (res.json as {
							error?: {
								status?: string;
								message?: string;
								details?: Array<{ reason?: string }>;
							};
						})
					: null;
			const reason = body?.error?.details?.[0]?.reason;
			if (reason === "SERVICE_DISABLED") {
				throw new Error(
					`People API directory lookup failed (HTTP 403): ${res.text}`
				);
			}
			// Workspace admin policy (https://support.google.com/a/answer/6343701),
			// not a scope/consent problem — no `details`/`reason` on this one, only
			// a message. Deterministic and permanent for the rest of this session
			// (every email fails identically), unlike the generic 403 below where
			// retrying after a re-auth might plausibly help. Throw so the caller's
			// existing "stop retrying" handling (PersonNameCache.disabled /
			// avatar-resolve's session flag) kicks in instead of re-attempting
			// this doomed call on every single poll forever.
			if (body?.error?.message?.includes("external directory sharing")) {
				mcLog(
					"directory",
					"people lookup blocked by Workspace admin policy (external directory sharing disabled)",
					{ email: key, body: res.text }
				);
				throw new Error(
					`People API directory lookup blocked by Workspace admin policy: ${res.text}`
				);
			}
			// Missing scope / not allowed — don't persist a year-long miss
			// and don't session-cache (undefined = inconclusive). Always-on
			// (like the 429 log): a silent 403 here previously looked
			// identical to a rate-limit cooldown skip in the "resolve done"
			// summary, with no way to tell them apart.
			mcLog("directory", "people lookup 403 (non-SERVICE_DISABLED)", {
				email: key,
				reason,
				body: res.text,
			});
			return undefined;
		}
		if (res.status === 404) {
			directoryCache?.setPerson(key, null);
			return { name: null, photoUrl: null };
		}
		if (res.status >= 400) {
			throw new Error(
				`People API searchDirectoryPeople HTTP ${res.status}: ${res.text}`
			);
		}
		const people = (res.json as { people?: RawDirectoryPerson[] })?.people;
		for (const person of people ?? []) {
			const emails = (person.emailAddresses ?? [])
				.map((e) => normEmail(e.value ?? ""))
				.filter(Boolean);
			// searchDirectoryPeople is prefix-based — only accept an exact
			// email match so a neighboring hit can't steal the label/photo.
			if (!emails.includes(key)) continue;
			const name = (
				person.names?.[0]?.displayName ||
				person.names?.[0]?.unstructuredName ||
				""
			).trim();
			const photoUrl = pickRealPhotoUrl(person.photos);
			if (name || photoUrl) {
				directoryCache?.setPerson(key, name || null, photoUrl);
				return { name: name || null, photoUrl };
			}
		}
		directoryCache?.setPerson(key, null);
		return { name: null, photoUrl: null };
	}

	return {
		async resolveDisplayName(
			email: string
		): Promise<string | null | undefined> {
			const result = await lookup(email);
			return result === undefined ? undefined : result.name;
		},
		async resolvePhotoUrl(
			email: string
		): Promise<string | null | undefined> {
			const result = await lookup(email);
			return result === undefined ? undefined : result.photoUrl;
		},
	};
}
