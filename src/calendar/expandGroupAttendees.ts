import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import type { DirectoryCache } from "./directoryCache";
import {
	PersonNameCache,
	resolveAttendeeLabel,
	type PersonDirectory,
} from "./personDirectory";

const CI_API = "https://cloudidentity.googleapis.com/v1";

/** Calendar attendee fields we need for expansion. */
export interface ExpandableAttendee {
	email?: string;
	displayName?: string;
	resource?: boolean;
}

export interface GroupMember {
	email: string;
	/** Cloud Identity membership type (`USER`, `GROUP`, …). */
	type: string;
}

export interface ListMembersOptions {
	/** Stop paging once at least this many members are collected. */
	limit?: number;
}

/**
 * Minimal Cloud Identity Groups surface used to expand group invitees into
 * people. Implementations may hit the network or be fakes in tests.
 */
export interface GroupDirectory {
	/**
	 * Resolve an email to a Cloud Identity group resource name (`groups/…`).
	 * - `string` — confirmed group
	 * - `null` — confirmed not a group (safe to session-cache as person)
	 * - `undefined` — inconclusive (e.g. 403 missing scope); do not cache as person
	 */
	lookup(email: string): Promise<string | null | undefined>;
	/** Members for a group resource name. */
	listMembers(
		groupResourceName: string,
		opts?: ListMembersOptions
	): Promise<GroupMember[]>;
}

/** Default cap on people expanded from one group invitee. */
export const DEFAULT_GROUP_EXPAND_MAX_MEMBERS = 50;

export interface ExpandOptions {
	/** Max nested-group depth (root group = depth 0). Default 3. */
	maxDepth?: number;
	/** Cap on expanded people for one root attendee. Default 50. */
	maxPeople?: number;
}

type EmailKind = "person" | "group";

/** Session cache shared across events in one calendar fetch. */
export class GroupExpandCache {
	kind = new Map<string, EmailKind>();
	groupResource = new Map<string, string>();
	members = new Map<string, GroupMember[]>();
	/** Set when Groups API is disabled / hard-fails — skip further *network* lookups. */
	disabled = false;
}

function normEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** Stable fingerprint of invitees so session cache invalidates when Calendar changes. */
export function inviteeFingerprint(
	invitees: ExpandableAttendee[] | undefined
): string {
	return (invitees ?? [])
		.map((a) => {
			const email = normEmail(a.email ?? "");
			const display = (a.displayName ?? "").trim();
			return `${email}|${display}`;
		})
		.sort()
		.join("\n");
}

/**
 * Expand a single email into person emails. Nested groups (`type=GROUP`) are
 * walked up to `maxDepth`. Failures leave the address unexpanded. Cached
 * expansions remain usable even after `cache.disabled` flips.
 */
export async function expandEmailToPeople(
	email: string,
	dir: GroupDirectory,
	opts: ExpandOptions = {},
	cache: GroupExpandCache = new GroupExpandCache(),
	depth = 0
): Promise<string[]> {
	const maxDepth = opts.maxDepth ?? 3;
	const maxPeople = opts.maxPeople ?? DEFAULT_GROUP_EXPAND_MAX_MEMBERS;
	const key = normEmail(email);
	if (!key.includes("@")) return [email.trim()].filter(Boolean);

	// Prefer cache before honoring `disabled`, so a later failure in the same
	// sync does not collapse an already-expanded group back to its address.
	const cachedKind = cache.kind.get(key);
	if (cachedKind === "person") return [key];
	if (cachedKind === "group") {
		const resource = cache.groupResource.get(key);
		if (!resource) return [key];
		return expandGroupResource(resource, dir, opts, cache, depth, maxPeople);
	}

	if (cache.disabled) return [key];
	if (depth > maxDepth) return [key];

	let resource: string | null | undefined;
	try {
		resource = await dir.lookup(key);
	} catch (err) {
		cache.disabled = true;
		console.warn(
			"[Meeting Copilot] Cloud Identity Groups lookup failed; leaving group invitees unexpanded.",
			err
		);
		return [key];
	}

	if (resource === undefined) {
		// Inconclusive (e.g. 403) — leave unexpanded and allow a later retry
		// after reauth without pinning "person" for the rest of the session.
		return [key];
	}
	if (!resource) {
		cache.kind.set(key, "person");
		return [key];
	}

	cache.kind.set(key, "group");
	cache.groupResource.set(key, resource);
	return expandGroupResource(resource, dir, opts, cache, depth, maxPeople);
}

async function expandGroupResource(
	resource: string,
	dir: GroupDirectory,
	opts: ExpandOptions,
	cache: GroupExpandCache,
	depth: number,
	maxPeople: number
): Promise<string[]> {
	const maxDepth = opts.maxDepth ?? 3;
	let members = cache.members.get(resource);
	if (!members) {
		if (cache.disabled) return [];
		try {
			// Fetch a little past maxPeople so nested GROUP rows still appear
			// when mixed into a large flat membership list.
			members = await dir.listMembers(resource, {
				limit: Math.max(maxPeople * 2, maxPeople + 25),
			});
		} catch (err) {
			cache.disabled = true;
			console.warn(
				"[Meeting Copilot] Cloud Identity Groups memberships.list failed; leaving group invitees unexpanded.",
				err
			);
			return [];
		}
		cache.members.set(resource, members);
	}

	const out: string[] = [];
	const seen = new Set<string>();

	const pushPerson = (email: string, markPerson = true): void => {
		const p = normEmail(email);
		if (!p || seen.has(p) || out.length >= maxPeople) return;
		seen.add(p);
		out.push(p);
		// Only mark confirmed people — a depth-capped nested GROUP must not be
		// cached as "person" or a later root invite of the same address won't expand.
		if (markPerson) cache.kind.set(p, "person");
	};

	for (const member of members) {
		if (out.length >= maxPeople) break;
		const memberEmail = normEmail(member.email);
		if (!memberEmail) continue;

		const isGroup = member.type.toUpperCase() === "GROUP";
		if (isGroup && depth >= maxDepth) {
			pushPerson(memberEmail, false);
			continue;
		}
		if (!isGroup) {
			pushPerson(memberEmail, true);
			continue;
		}

		const nested = await expandEmailToPeople(
			memberEmail,
			dir,
			opts,
			cache,
			depth + 1
		);
		// Append nested results without re-marking cache.kind — a depth-capped
		// GROUP placeholder must stay unmarked so a later root invite can expand.
		for (const person of nested) {
			const p = normEmail(person);
			if (!p || seen.has(p) || out.length >= maxPeople) continue;
			seen.add(p);
			out.push(p);
		}
	}
	return out;
}

/**
 * Map calendar attendees to display labels, expanding group emails into
 * member people when Cloud Identity allows. Resources are dropped. Order is
 * stable; duplicates (by lowercased email) are removed. Soft-fails to the
 * original displayName/email when expansion is unavailable.
 *
 * Labels prefer Calendar `displayName`, then People directory name, then a
 * humanized local-part — never a bare email when a better label exists.
 */
export async function mapAttendeesExpanded(
	raw: ExpandableAttendee[] | undefined,
	dir: GroupDirectory,
	opts: ExpandOptions = {},
	cache: GroupExpandCache = new GroupExpandCache(),
	people: PersonDirectory | null = null,
	personCache: PersonNameCache = new PersonNameCache()
): Promise<string[]> {
	const labelByEmail = new Map<string, string>();
	const nameless: string[] = [];
	const order: string[] = [];

	const remember = (emailKey: string, label: string): void => {
		if (!emailKey || labelByEmail.has(emailKey)) return;
		labelByEmail.set(emailKey, label);
		order.push(emailKey);
	};

	// Direct invitee display names win over directory/humanized expansions.
	const directDisplay = new Map<string, string>();
	for (const a of raw ?? []) {
		if (a.resource) continue;
		const email = normEmail(a.email ?? "");
		const display = (a.displayName ?? "").trim();
		if (email && display) directDisplay.set(email, display);
	}

	for (const a of raw ?? []) {
		if (a.resource) continue;
		const email = (a.email ?? "").trim();
		const display = (a.displayName ?? "").trim();
		if (!email) {
			if (display && !nameless.includes(display)) nameless.push(display);
			continue;
		}

		const key = normEmail(email);
		const peopleEmails = await expandEmailToPeople(email, dir, opts, cache);
		const wasGroup = cache.kind.get(key) === "group";

		if (!wasGroup) {
			remember(
				key,
				await resolveAttendeeLabel(email, display, people, personCache)
			);
			continue;
		}

		if (peopleEmails.length === 0) {
			remember(
				key,
				await resolveAttendeeLabel(email, display, people, personCache)
			);
			continue;
		}

		for (const personEmail of peopleEmails) {
			const pKey = normEmail(personEmail);
			if (!pKey) continue;
			remember(
				pKey,
				await resolveAttendeeLabel(
					personEmail,
					directDisplay.get(pKey),
					people,
					personCache
				)
			);
		}
	}

	// Overlay direct display names in case the group was expanded first.
	for (const [email, display] of directDisplay) {
		if (labelByEmail.has(email)) labelByEmail.set(email, display);
	}

	return [...nameless, ...order.map((k) => labelByEmail.get(k)!)];
}

/**
 * Live Cloud Identity Groups client backed by the plugin's Google OAuth token.
 * When a {@link DirectoryCache} is provided, lookups/memberships are persisted
 * for {@link import("./directoryCache").GROUP_TTL_MS}.
 */
export function createCloudIdentityDirectory(
	oauth: GoogleOAuth,
	directoryCache?: DirectoryCache
): GroupDirectory {
	return {
		async lookup(email: string): Promise<string | null | undefined> {
			const key = email.trim().toLowerCase();
			const cached = directoryCache?.getGroup(key);
			if (cached !== undefined) return cached.resource;

			const token = await oauth.getAccessToken();
			const url = `${CI_API}/groups:lookup?groupKey.id=${encodeURIComponent(email)}`;
			const res = await requestUrl({
				url,
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				throw: false,
			});
			if (res.status === 404) {
				directoryCache?.setGroupLookup(key, null);
				return null;
			}
			if (res.status === 403) {
				const body =
					typeof res.json === "object" && res.json
						? (res.json as {
								error?: { details?: Array<{ reason?: string }> };
							})
						: null;
				const reason = body?.error?.details?.[0]?.reason;
				if (reason === "SERVICE_DISABLED") {
					throw new Error(
						`Cloud Identity API disabled (HTTP 403): ${res.text}`
					);
				}
				// Not allowed / missing scope — do NOT persist as "not a group"
				// (disk) and return undefined so the session cache does not pin
				// "person" either (reauth can retry in the same session).
				return undefined;
			}
			if (res.status >= 400) {
				throw new Error(
					`Cloud Identity groups.lookup HTTP ${res.status}: ${res.text}`
				);
			}
			const name = (res.json as { name?: string })?.name;
			const resource =
				name && name.startsWith("groups/") ? name : null;
			directoryCache?.setGroupLookup(key, resource);
			return resource;
		},

		async listMembers(
			groupResourceName: string,
			opts: ListMembersOptions = {}
		): Promise<GroupMember[]> {
			const cached = directoryCache?.getGroupByResource(groupResourceName);
			if (cached?.members) {
				const limit = opts.limit;
				return limit !== undefined
					? cached.members.slice(0, limit)
					: cached.members;
			}

			const token = await oauth.getAccessToken();
			const limit = opts.limit;
			const pageSize =
				limit !== undefined
					? Math.min(200, Math.max(1, limit))
					: 200;
			const members: GroupMember[] = [];
			let pageToken: string | undefined;
			let truncated = false;
			for (let page = 0; page < 20; page++) {
				const params = new URLSearchParams({
					pageSize: String(pageSize),
					view: "FULL",
				});
				if (pageToken) params.set("pageToken", pageToken);
				const url = `${CI_API}/${groupResourceName}/memberships?${params}`;
				const res = await requestUrl({
					url,
					method: "GET",
					headers: { Authorization: `Bearer ${token}` },
					throw: false,
				});
				if (res.status >= 400) {
					throw new Error(
						`Cloud Identity memberships.list HTTP ${res.status}: ${res.text}`
					);
				}
				const json = res.json as {
					memberships?: Array<{
						preferredMemberKey?: { id?: string };
						type?: string;
					}>;
					nextPageToken?: string;
				};
				for (const m of json.memberships ?? []) {
					const id = (m.preferredMemberKey?.id ?? "").trim();
					if (!id) continue;
					members.push({
						email: id,
						type: (m.type ?? "USER").toUpperCase(),
					});
					if (limit !== undefined && members.length >= limit) {
						truncated = true;
						break;
					}
				}
				if (truncated) break;
				pageToken = json.nextPageToken || undefined;
				if (!pageToken) break;
			}
			// Only persist complete membership lists — a limit-truncated fetch
			// must not poison the week-long cache.
			if (!truncated) {
				directoryCache?.setGroupMembersByResource(
					groupResourceName,
					members
				);
			}
			return members;
		},
	};
}
