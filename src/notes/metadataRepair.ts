/**
 * Pure logic for inferring a note's 1:1 or recurring-series identity from its
 * sibling notes — used both when a note is auto-detected moving into a folder
 * and by the manual "Fix meeting metadata" command/menu items. Kept
 * Obsidian-free so it's testable without a vault; the sibling scan (always
 * scoped to one folder's *direct* children, never subfolders — a note two
 * levels down shouldn't be able to steer, or be steered by, a sibling that
 * isn't really its sibling) and the actual frontmatter write happen in the
 * plugin.
 *
 * The problem this solves: a note only carries `one_on_one_with`/
 * `recurring_event_id` when the plugin itself created it from a calendar
 * event. A note started ad-hoc and later dragged into a 1:1 or series folder
 * keeps neither — so it reads as "ad-hoc" in the dashboard forever, and worse,
 * the plugin's own note-reuse lookup (`resolveMeetingFolder`) won't recognize
 * it either, so the *next* calendar occurrence creates a duplicate note
 * instead of continuing this one. Inferring identity from folder siblings
 * (which usually include at least one properly-tagged note, since that's how
 * the folder came to represent that person/series in the first place) fixes
 * both at once.
 */

import { seriesKey } from "../calendar/recurringSeries";

export interface SiblingIdentity {
	oneOnOneWith: string | null;
	oneOnOneEmail: string | null;
	recurringEventId: string | null;
	/** The sibling's own title — becomes the inferred series' display title. */
	title: string;
}

export type InferredIdentity =
	| { kind: "one-on-one"; name: string; email: string | null }
	| { kind: "recurring"; recurringEventId: string; title: string };

export interface OneOnOneCandidate {
	name: string;
	email: string | null;
	/** How many siblings matched this candidate — helps distinguish two candidates that render the same label (e.g. a recurring series recreated under a new event ID keeps its old title). */
	count: number;
}

export interface RecurringCandidate {
	recurringEventId: string;
	title: string;
	/** How many siblings matched this candidate. */
	count: number;
}

/** Every distinct identity found among a set of siblings, each with how many siblings matched it. */
function countCandidates(siblings: SiblingIdentity[]): {
	oneOnOnes: OneOnOneCandidate[];
	recurring: RecurringCandidate[];
} {
	const oneOnOnes = new Map<string, OneOnOneCandidate>();
	const recurring = new Map<string, RecurringCandidate>();
	for (const s of siblings) {
		// A note can legitimately carry both (a recurring 1:1) — 1:1 identity
		// wins, same priority the agenda's own accent classification uses, so
		// one sibling contributes evidence for exactly one bucket rather than
		// looking like a mixed/ambiguous folder.
		if (s.oneOnOneWith) {
			const key = s.oneOnOneEmail ?? s.oneOnOneWith.trim().toLowerCase();
			const existing = oneOnOnes.get(key);
			if (existing) existing.count++;
			else oneOnOnes.set(key, { name: s.oneOnOneWith, email: s.oneOnOneEmail, count: 1 });
		} else if (s.recurringEventId) {
			// Keyed by the normalized series id, not the raw one: Google
			// mints a new recurringEventId for the tail of a series whenever
			// it's split ("edit this and following events"), so two
			// siblings can belong to the exact same real series yet carry
			// different raw ids — see seriesKey's own doc comment. Without
			// this, that split alone made an otherwise-clean folder look
			// "ambiguous" (two candidates, neither a majority).
			const key = seriesKey(s.recurringEventId);
			const existing = recurring.get(key);
			if (existing) existing.count++;
			else {
				recurring.set(key, {
					recurringEventId: s.recurringEventId,
					title: s.title,
					count: 1,
				});
			}
		}
	}
	return { oneOnOnes: [...oneOnOnes.values()], recurring: [...recurring.values()] };
}

export type IdentityInference =
	| { kind: "resolved"; identity: InferredIdentity }
	/** No identified sibling at all — nothing to learn from. */
	| { kind: "none" }
	/**
	 * More than one distinct identity found among the siblings — the folder
	 * itself is unclean (mixes two people, two series, or both), so guessing
	 * would risk mistagging a note. Callers should report the specific
	 * candidates so the user can clean the folder up manually.
	 */
	| {
			kind: "ambiguous";
			oneOnOnes: OneOnOneCandidate[];
			recurring: RecurringCandidate[];
	  };

/**
 * Infers identity from a folder's siblings: the same 1:1 partner (matched by
 * email when known, else by name) or the same recurring series
 * (`recurring_event_id`) across every identified sibling — *every* sibling
 * must agree, so this is the conservative rule for something that will
 * actually be auto-applied (the fix commands). `"ambiguous"` carries every
 * distinct candidate found, so the caller can tell the user exactly what
 * disagrees instead of just refusing to guess. For a majority-tolerant
 * version used only for diagnostics, see {@link findNoteIssues}.
 */
export function inferIdentityFromSiblings(
	siblings: SiblingIdentity[]
): IdentityInference {
	const { oneOnOnes, recurring } = countCandidates(siblings);
	if (oneOnOnes.length === 0 && recurring.length === 0) {
		return { kind: "none" };
	}
	if (oneOnOnes.length === 1 && recurring.length === 0) {
		const c = oneOnOnes[0]!;
		return {
			kind: "resolved",
			identity: { kind: "one-on-one", name: c.name, email: c.email },
		};
	}
	if (recurring.length === 1 && oneOnOnes.length === 0) {
		const c = recurring[0]!;
		return {
			kind: "resolved",
			identity: {
				kind: "recurring",
				recurringEventId: c.recurringEventId,
				title: c.title,
			},
		};
	}
	return { kind: "ambiguous", oneOnOnes, recurring };
}

/** Stable key for comparing two identities — same rule the candidate counting dedupes with (email over name for a 1:1). */
function identityKey(identity: InferredIdentity): string {
	return identity.kind === "one-on-one"
		? `1:1:${identity.email ?? identity.name.trim().toLowerCase()}`
		: `series:${seriesKey(identity.recurringEventId)}`;
}

export interface NoteIdentityRow {
	path: string;
	/**
	 * The candidate "series title" siblings vote on (frontmatter `title`,
	 * falling back to the file's basename) — every occurrence of a recurring
	 * meeting typically shares the same one, which is exactly what makes it
	 * useless for telling two *specific* notes apart. For that, see
	 * {@link fileTitle}.
	 */
	title: string;
	/** The file's own basename — what a {@link NoteIssue} displays, since it's what the user sees in the file tree and is unique per note (unlike {@link title}). */
	fileTitle: string;
	folder: string;
	/** Matches `looksLikeMeetingNote()` — a note that isn't one of ours at all is ignored entirely. */
	looksLikeMeetingNote: boolean;
	oneOnOneWith: string | null;
	oneOnOneEmail: string | null;
	recurringEventId: string | null;
}

export type NoteIssueReason =
	/** Untagged, but the folder's majority identity is clear. */
	| { kind: "missing"; identity: InferredIdentity }
	/** No single identity has more siblings than the runner-up — a real tie, not just "more than one candidate". */
	| { kind: "ambiguous"; oneOnOnes: OneOnOneCandidate[]; recurring: RecurringCandidate[] }
	/** Tagged, but disagrees with the folder's own majority identity. */
	| { kind: "outlier"; actual: InferredIdentity; expected: InferredIdentity };

export interface NoteIssue {
	path: string;
	title: string;
	folder: string;
	reason: NoteIssueReason;
}

/**
 * A folder's majority identity among its tagged notes — tolerant of a
 * minority of disagreeing notes, unlike {@link inferIdentityFromSiblings}'s
 * strict "everyone must agree" rule. `"resolved"` requires a strict plurality
 * (the top candidate has strictly more matches than the runner-up); an exact
 * tie is `"ambiguous"` — there's no way to call a majority, so nothing should
 * be flagged as a minority "outlier" of the other.
 */
function majorityIdentity(
	tagged: SiblingIdentity[]
): IdentityInference {
	const { oneOnOnes, recurring } = countCandidates(tagged);
	const all = [
		...oneOnOnes.map((c) => ({
			identity: { kind: "one-on-one", name: c.name, email: c.email } as InferredIdentity,
			count: c.count,
		})),
		...recurring.map((c) => ({
			identity: {
				kind: "recurring",
				recurringEventId: c.recurringEventId,
				title: c.title,
			} as InferredIdentity,
			count: c.count,
		})),
	];
	if (all.length === 0) return { kind: "none" };
	if (all.length === 1) return { kind: "resolved", identity: all[0]!.identity };
	const [top, runnerUp] = [...all].sort((a, b) => b.count - a.count);
	if (top!.count > runnerUp!.count) {
		return { kind: "resolved", identity: top!.identity };
	}
	return { kind: "ambiguous", oneOnOnes, recurring };
}

function toSibling(row: NoteIdentityRow): SiblingIdentity {
	return {
		oneOnOneWith: row.oneOnOneWith,
		oneOnOneEmail: row.oneOnOneEmail,
		recurringEventId: row.recurringEventId,
		title: row.title,
	};
}

/**
 * Vault-wide sanity check, grouping notes by their *direct* parent folder
 * (same non-recursive rule {@link inferIdentityFromSiblings}'s caller in the
 * plugin uses) and flagging three cases, using a majority-tolerant rule
 * (unlike the fix commands, this never writes anything, so a minority of
 * stray notes doesn't need to block a diagnosis the way it blocks an
 * auto-apply):
 *
 * 1. `"missing"` — an untagged note whose folder has a clear majority
 *    identity.
 * 2. `"outlier"` — a *tagged* note whose own identity disagrees with that
 *    majority (e.g. a stray note mistagged with the wrong partner).
 * 3. `"ambiguous"` — no candidate has more matches than the runner-up (a
 *    real tie); every note in the folder is flagged, since none of them can
 *    be trusted without a human sorting it out.
 *
 * A folder with no identity signal at all is not flagged — that's the normal
 * state for a genuinely ad-hoc folder, not a problem to report. Honours
 * `oneOnOneSeparately` the same way the manual fix commands do: with it off,
 * a folder full of untagged 1:1-shaped notes isn't "missing" anything, since
 * 1:1 metadata wouldn't be read anywhere.
 */
export function findNoteIssues(
	rows: NoteIdentityRow[],
	oneOnOneSeparately: boolean
): NoteIssue[] {
	const byFolder = new Map<string, NoteIdentityRow[]>();
	for (const row of rows) {
		if (!row.looksLikeMeetingNote) continue;
		const list = byFolder.get(row.folder);
		if (list) list.push(row);
		else byFolder.set(row.folder, [row]);
	}

	const issues: NoteIssue[] = [];
	for (const [folder, folderRows] of byFolder) {
		const tagged = folderRows.filter(
			(r) => r.oneOnOneWith || r.recurringEventId
		);
		const untagged = folderRows.filter(
			(r) => !r.oneOnOneWith && !r.recurringEventId
		);
		const result = majorityIdentity(tagged.map(toSibling));

		if (result.kind === "none") continue;
		if (result.kind === "ambiguous") {
			for (const row of folderRows) {
				issues.push({
					path: row.path,
					title: row.fileTitle,
					folder,
					reason: {
						kind: "ambiguous",
						oneOnOnes: result.oneOnOnes,
						recurring: result.recurring,
					},
				});
			}
			continue;
		}
		if (result.identity.kind === "one-on-one" && !oneOnOneSeparately) continue;

		for (const row of untagged) {
			issues.push({
				path: row.path,
				title: row.fileTitle,
				folder,
				reason: { kind: "missing", identity: result.identity },
			});
		}

		const expectedKey = identityKey(result.identity);
		for (const row of tagged) {
			const own = majorityIdentity([toSibling(row)]);
			if (own.kind !== "resolved") continue;
			if (identityKey(own.identity) === expectedKey) continue;
			issues.push({
				path: row.path,
				title: row.fileTitle,
				folder,
				reason: {
					kind: "outlier",
					actual: own.identity,
					expected: result.identity,
				},
			});
		}
	}
	return issues;
}
