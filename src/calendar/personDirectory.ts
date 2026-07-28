import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { humanizeEmailName } from "./attendeeNames";
import {
	DirectoryCache,
	PeopleApiRateLimiter,
	sleep,
} from "./directoryCache";

const PEOPLE_API = "https://people.googleapis.com/v1";

/**
 * Workspace directory lookups for display names. Non-admin People API
 * (`directory.readonly`) — not Admin SDK Directory.
 */
export interface PersonDirectory {
	/**
	 * Resolve a workspace user's display name from their email, or `null` when
	 * the directory has no usable name for that address.
	 */
	resolveDisplayName(email: string): Promise<string | null>;
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
	if (cache.miss.has(key) || cache.disabled || !people) {
		return humanizeEmailName(key) || key;
	}

	try {
		const name = await people.resolveDisplayName(key);
		if (name) {
			cache.names.set(key, name);
			return name;
		}
		cache.miss.add(key);
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
}

/**
 * Live People API client (searchDirectoryPeople) backed by the plugin's OAuth.
 * Honors {@link DirectoryCache} + {@link PeopleApiRateLimiter} when provided.
 */
export function createPeopleDirectory(
	oauth: GoogleOAuth,
	opts: PeopleDirectoryOptions = {}
): PersonDirectory {
	const { directoryCache, rateLimiter } = opts;
	return {
		async resolveDisplayName(email: string): Promise<string | null> {
			const key = normEmail(email);
			const cached = directoryCache?.getPerson(key);
			if (cached !== undefined) return cached.name;

			if (directoryCache?.peopleIsRateLimited()) {
				return null;
			}

			if (rateLimiter) {
				const wait = rateLimiter.waitMs();
				if (wait > 0) await sleep(wait);
				rateLimiter.record();
			}

			const token = await oauth.getAccessToken();
			const url =
				`${PEOPLE_API}/people:searchDirectoryPeople` +
				`?query=${encodeURIComponent(email)}` +
				`&readMask=${encodeURIComponent("names,emailAddresses")}` +
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
				directoryCache?.setPerson(key, null);
				return null;
			}
			if (res.status === 404) {
				directoryCache?.setPerson(key, null);
				return null;
			}
			if (res.status >= 400) {
				throw new Error(
					`People API searchDirectoryPeople HTTP ${res.status}: ${res.text}`
				);
			}
			const people = (
				res.json as {
					people?: Array<{
						names?: Array<{
							displayName?: string;
							unstructuredName?: string;
						}>;
						emailAddresses?: Array<{ value?: string }>;
					}>;
				}
			)?.people;
			for (const person of people ?? []) {
				const emails = (person.emailAddresses ?? [])
					.map((e) => normEmail(e.value ?? ""))
					.filter(Boolean);
				// searchDirectoryPeople is prefix-based — only accept an exact
				// email match so a neighboring hit can't steal the label.
				if (!emails.includes(key)) continue;
				const name = (
					person.names?.[0]?.displayName ||
					person.names?.[0]?.unstructuredName ||
					""
				).trim();
				if (name) {
					directoryCache?.setPerson(key, name);
					return name;
				}
			}
			directoryCache?.setPerson(key, null);
			return null;
		},
	};
}
