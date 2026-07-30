import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { mcLog } from "../util/logLine";
import { DirectoryCache, PeopleApiRateLimiter, sleep } from "./directoryCache";
import type { RawDirectoryPerson } from "./personDirectory";

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
 * correspondence — into the shared {@link DirectoryCache} (name only; see
 * below on photos).
 *
 * This is a second, independent path to the same kind of data that
 * `personDirectory.ts`'s `searchDirectoryPeople` resolves, for a specific
 * reason: some Workspace domains disable "external directory sharing"
 * entirely (see that file's 403 handling), which blocks the org-Directory
 * lookup for *every* attendee, permanently, for that domain. "Other
 * contacts" is the user's own private data, not the org Directory, so it
 * isn't subject to that admin setting.
 *
 * Photos are intentionally never taken from this endpoint — verified by
 * downloading and inspecting real cached photo URLs across several accounts,
 * every one was Google's generated colored-initial circle, including entries
 * marked `default: false` (which reliably means "real photo" on the
 * directory-search path). The same generated image routinely recurs across
 * unrelated people here too, so there is no reliable signal at all on this
 * endpoint for "this is a real uploaded photo." Name resolution is unaffected.
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
			readMask: "names,emailAddresses",
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
			// otherContacts photos are never trusted, even when `default: false`.
			// Confirmed by downloading and visually inspecting ~15 cached URLs
			// across several real accounts/domains: every one was a generated
			// colored-initial circle, never a real uploaded photo — including
			// ones marked `default: false`, which elsewhere reliably means "real
			// photo". Worse, the same generated image recurred across unrelated
			// people (2,103 cached emails collapsed to 626 distinct images, 401
			// of them shared by 2+ people), so `default` simply isn't a valid
			// real-vs-generated signal on this endpoint. Name resolution from
			// otherContacts is still useful and unaffected; only photos are
			// unusable here. See `pickRealPhotoUrl` for the directory-search
			// path, where `default` does still apply.
			if (!name) continue;
			for (const e of person.emailAddresses ?? []) {
				const email = normEmail(e.value ?? "");
				if (!email) continue;
				directoryCache.setPerson(email, name, null);
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
