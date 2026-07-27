import { requestUrl } from "obsidian";
import type { GoogleOAuth } from "../auth/googleOAuth";
import { humanizeEmailName } from "./attendeeNames";

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

/**
 * Minimal Cloud Identity Groups surface used to expand group invitees into
 * people. Implementations may hit the network or be fakes in tests.
 */
export interface GroupDirectory {
	/**
	 * Resolve an email to a Cloud Identity group resource name (`groups/…`),
	 * or `null` when the address is not a group the caller can see.
	 */
	lookup(email: string): Promise<string | null>;
	/** Members for a group resource name. */
	listMembers(groupResourceName: string): Promise<GroupMember[]>;
}

export interface ExpandOptions {
	/** Max nested-group depth (root group = depth 0). Default 3. */
	maxDepth?: number;
	/** Cap on expanded people for one root attendee. Default 500. */
	maxPeople?: number;
}

type EmailKind = "person" | "group";

/** Session cache shared across events in one calendar fetch. */
export class GroupExpandCache {
	kind = new Map<string, EmailKind>();
	groupResource = new Map<string, string>();
	members = new Map<string, GroupMember[]>();
	/** Set when Groups API is disabled / hard-fails — skip further lookups. */
	disabled = false;
}

function normEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Expand a single email into person emails. Nested groups (`type=GROUP`) are
 * walked up to `maxDepth`. Failures leave the address unexpanded.
 */
export async function expandEmailToPeople(
	email: string,
	dir: GroupDirectory,
	opts: ExpandOptions = {},
	cache: GroupExpandCache = new GroupExpandCache(),
	depth = 0
): Promise<string[]> {
	const maxDepth = opts.maxDepth ?? 3;
	const maxPeople = opts.maxPeople ?? 500;
	const key = normEmail(email);
	if (!key.includes("@")) return [email.trim()].filter(Boolean);

	if (cache.disabled) return [key];

	const cachedKind = cache.kind.get(key);
	if (cachedKind === "person") return [key];
	if (cachedKind === "group") {
		const resource = cache.groupResource.get(key);
		if (!resource) return [key];
		return expandGroupResource(resource, dir, opts, cache, depth, maxPeople);
	}

	if (depth > maxDepth) return [key];

	let resource: string | null;
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
		try {
			members = await dir.listMembers(resource);
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

	const pushPerson = (email: string): void => {
		const p = normEmail(email);
		if (!p || seen.has(p) || out.length >= maxPeople) return;
		seen.add(p);
		out.push(p);
		cache.kind.set(p, "person");
	};

	for (const member of members) {
		if (out.length >= maxPeople) break;
		const memberEmail = normEmail(member.email);
		if (!memberEmail) continue;

		const isGroup = member.type.toUpperCase() === "GROUP";
		if (!isGroup || depth >= maxDepth) {
			pushPerson(memberEmail);
			continue;
		}

		const nested = await expandEmailToPeople(
			memberEmail,
			dir,
			opts,
			cache,
			depth + 1
		);
		for (const person of nested) pushPerson(person);
	}
	return out;
}

/**
 * Map calendar attendees to display labels, expanding group emails into
 * member people when Cloud Identity allows. Resources are dropped. Order is
 * stable; duplicates (by lowercased email) are removed. Soft-fails to the
 * original displayName/email when expansion is unavailable.
 */
export async function mapAttendeesExpanded(
	raw: ExpandableAttendee[] | undefined,
	dir: GroupDirectory,
	opts: ExpandOptions = {},
	cache: GroupExpandCache = new GroupExpandCache()
): Promise<string[]> {
	const labels: string[] = [];
	const seen = new Set<string>();

	for (const a of raw ?? []) {
		if (a.resource) continue;
		const email = (a.email ?? "").trim();
		const display = (a.displayName ?? "").trim();
		if (!email) {
			if (display && !seen.has(display.toLowerCase())) {
				seen.add(display.toLowerCase());
				labels.push(display);
			}
			continue;
		}

		const people = await expandEmailToPeople(email, dir, opts, cache);
		const wasGroup = cache.kind.get(normEmail(email)) === "group";

		if (!wasGroup) {
			const label = display || humanizeEmailName(email) || email;
			const dedupeKey = normEmail(email);
			if (!seen.has(dedupeKey)) {
				seen.add(dedupeKey);
				labels.push(label);
			}
			continue;
		}

		if (people.length === 0) {
			const label = display || email;
			const dedupeKey = normEmail(email);
			if (!seen.has(dedupeKey)) {
				seen.add(dedupeKey);
				labels.push(label);
			}
			continue;
		}

		for (const personEmail of people) {
			const key = normEmail(personEmail);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			labels.push(humanizeEmailName(personEmail));
		}
	}

	return labels;
}

/**
 * Live Cloud Identity Groups client backed by the plugin's Google OAuth token.
 */
export function createCloudIdentityDirectory(
	oauth: GoogleOAuth
): GroupDirectory {
	return {
		async lookup(email: string): Promise<string | null> {
			const token = await oauth.getAccessToken();
			const url = `${CI_API}/groups:lookup?groupKey.id=${encodeURIComponent(email)}`;
			const res = await requestUrl({
				url,
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				throw: false,
			});
			if (res.status === 404) return null;
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
				// Not allowed to see this group — treat as a non-group label.
				return null;
			}
			if (res.status >= 400) {
				throw new Error(
					`Cloud Identity groups.lookup HTTP ${res.status}: ${res.text}`
				);
			}
			const name = (res.json as { name?: string })?.name;
			return name && name.startsWith("groups/") ? name : null;
		},

		async listMembers(groupResourceName: string): Promise<GroupMember[]> {
			const token = await oauth.getAccessToken();
			const members: GroupMember[] = [];
			let pageToken: string | undefined;
			for (let page = 0; page < 20; page++) {
				const params = new URLSearchParams({
					pageSize: "200",
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
				}
				pageToken = json.nextPageToken || undefined;
				if (!pageToken) break;
			}
			return members;
		},
	};
}
