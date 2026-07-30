import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { mcLog } from "../util/logLine";
import { DirectoryCache, PeopleApiRateLimiter, sleep } from "./directoryCache";
import { pickRealPhotoUrl, type RawDirectoryPerson } from "./personDirectory";

const PEOPLE_API = "https://people.googleapis.com/v1";
/** Google's documented max for otherContacts.list. */
const OTHER_CONTACTS_PAGE_SIZE = 1000;

interface OtherContact extends RawDirectoryPerson {
	metadata?: { deleted?: boolean };
}

interface OtherContactsPage {
	otherContacts?: OtherContact[];
	nextPageToken?: string;
	nextSyncToken?: string;
}

export interface OtherContactsSyncResult {
	/** Distinct emails written to the directory cache this sync. */
	updated: number;
	/** False for an incremental (syncToken-based) sync. */
	full: boolean;
}

function normEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Syncs the user's Google "Other contacts" — people auto-added from Gmail
 * correspondence — into the shared {@link DirectoryCache} (name + photo).
 *
 * This is a second, independent path to the same kind of data that
 * `personDirectory.ts`'s `searchDirectoryPeople` resolves, for a specific
 * reason: some Workspace domains disable "external directory sharing"
 * entirely (see that file's 403 handling), which blocks the org-Directory
 * lookup for *every* attendee, permanently, for that domain. "Other
 * contacts" is the user's own private data, not the org Directory, so it
 * isn't subject to that admin setting — Granola-style tools showing photos
 * on such a domain are almost certainly using this path (or an
 * admin-delegated one we have no access to), not the Directory API.
 *
 * Unlike a per-email directory search, there's no photo-capable search here:
 * `otherContacts.search` doesn't support `photos` in its readMask, only
 * `otherContacts.list` does — so the only way to get photos is to page
 * through the *whole* list and match by email ourselves. A `syncToken` (once
 * one exists) limits a resync to what changed since last time instead of
 * re-paging everything.
 */
export async function syncOtherContacts(
	oauth: GoogleOAuth,
	directoryCache: DirectoryCache,
	rateLimiter?: PeopleApiRateLimiter
): Promise<OtherContactsSyncResult> {
	const startingToken = directoryCache.otherContactsSyncToken;
	const full = !startingToken;
	let pageToken: string | undefined;
	let nextSyncToken: string | undefined;
	let updated = 0;

	do {
		if (directoryCache.peopleIsRateLimited()) {
			mcLog("otherContacts", "sync paused (shared People API cooldown active)");
			return { updated, full };
		}
		if (rateLimiter) {
			const wait = rateLimiter.waitMs();
			if (wait > 0) await sleep(wait);
			rateLimiter.record();
		}

		const token = await oauth.getAccessToken();
		const params = new URLSearchParams({
			readMask: "names,emailAddresses,photos",
			pageSize: String(OTHER_CONTACTS_PAGE_SIZE),
			requestSyncToken: "true",
		});
		// syncToken only on the first request of an incremental sync; later
		// pages of the same sync carry the sync forward via pageToken alone.
		if (pageToken) {
			params.set("pageToken", pageToken);
		} else if (startingToken) {
			params.set("syncToken", startingToken);
		}

		const res = await requestUrl({
			url: `${PEOPLE_API}/otherContacts?${params.toString()}`,
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			throw: false,
		});

		if (res.status === 429) {
			directoryCache.markPeopleRateLimited(60_000);
			mcLog("otherContacts", "sync 429 — quota exceeded, 60s cooldown", {
				body: res.text,
			});
			return { updated, full };
		}
		if (res.status === 410) {
			// Expired/invalid syncToken — Google requires a full resync next time.
			directoryCache.setOtherContactsSynced(null);
			mcLog("otherContacts", "sync token expired; will full-resync next time");
			return { updated, full };
		}
		if (res.status === 403) {
			// Most likely: the user hasn't re-consented to the new scope yet
			// (callers should check GoogleOAuth.hasScope before calling this,
			// but re-check here too in case of a race with a token refresh).
			mcLog("otherContacts", "sync forbidden", { body: res.text });
			return { updated, full };
		}
		if (res.status >= 400) {
			throw new Error(
				`People API otherContacts HTTP ${res.status}: ${res.text}`
			);
		}

		const page = res.json as OtherContactsPage;
		for (const person of page.otherContacts ?? []) {
			if (person.metadata?.deleted) continue;
			const name = (
				person.names?.[0]?.displayName ||
				person.names?.[0]?.unstructuredName ||
				""
			).trim();
			// Unlike Workspace-directory results, otherContacts marks its one
			// real photo `default: true` too — don't exclude it here.
			const photoUrl = pickRealPhotoUrl(person.photos, {
				excludeDefault: false,
			});
			if (!name && !photoUrl) continue;
			for (const e of person.emailAddresses ?? []) {
				const email = normEmail(e.value ?? "");
				if (!email) continue;
				directoryCache.setPerson(email, name || null, photoUrl);
				updated++;
			}
		}
		pageToken = page.nextPageToken;
		if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
	} while (pageToken);

	directoryCache.setOtherContactsSynced(nextSyncToken ?? startingToken ?? null);
	mcLog("otherContacts", "sync done", { updated, full });
	return { updated, full };
}
