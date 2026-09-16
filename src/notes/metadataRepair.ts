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
	/**
	 * The note's meeting date, when it could be read. Used only to pick which
	 * id a *split* series counts as current — a meeting recreated or moved in
	 * the calendar gets a new `recurring_event_id`, and the newest note holds
	 * the one new occurrences will keep using.
	 */
	date?: Date | null;
}

export type NoteIssueReason =
	/** Untagged, but the folder's majority identity is clear. */
	| { kind: "missing"; identity: InferredIdentity }
	/** No single identity has more siblings than the runner-up — a real tie, not just "more than one candidate". */
	| { kind: "ambiguous"; oneOnOnes: OneOnOneCandidate[]; recurring: RecurringCandidate[] }
	/** Tagged, but disagrees with the folder's own majority identity. */
	| { kind: "outlier"; actual: InferredIdentity; expected: InferredIdentity };

/**
 * Shortened series id for display — `seriesKey` first, so the two halves of a
 * split lineage ("edit this and following") never look like different series.
 */
export function shortSeriesId(recurringEventId: string): string {
	const base = seriesKey(recurringEventId);
	return base.length > 10 ? `${base.slice(0, 10)}…` : base;
}

/**
 * Labels for an outlier's two sides. Two different identities routinely render
 * the *same* text — a recurring series recreated under a new id keeps its
 * title, so both read `the "Standup" series` and the message becomes "tagged as
 * X, but folder suggests X", which reads as a bug rather than a diagnosis.
 * When that happens each side gets the detail that actually distinguishes it
 * (series id, or a 1:1's email); when the labels already differ, nothing is
 * appended.
 */
export function disambiguateIdentityLabels(
	actual: InferredIdentity,
	expected: InferredIdentity,
	label: (identity: InferredIdentity) => string
): { actual: string; expected: string } {
	const actualLabel = label(actual);
	const expectedLabel = label(expected);
	if (actualLabel !== expectedLabel) {
		return { actual: actualLabel, expected: expectedLabel };
	}
	const detail = (identity: InferredIdentity): string | null =>
		identity.kind === "one-on-one"
			? (identity.email ?? null)
			: `id ${shortSeriesId(identity.recurringEventId)}`;
	const actualDetail = detail(actual);
	const expectedDetail = detail(expected);
	// Nothing distinguishes either side (two 1:1s, neither with an email):
	// leave the labels alone rather than appending empty parentheses.
	if (!actualDetail && !expectedDetail) {
		return { actual: actualLabel, expected: expectedLabel };
	}
	// One-sided is still worth showing: "(no email recorded)" against a real
	// address tells the user which note is the odd one out.
	const none = "no email recorded";
	return {
		actual: `${actualLabel} (${actualDetail ?? none})`,
		expected: `${expectedLabel} (${expectedDetail ?? none})`,
	};
}

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

/** Normalised series title — what decides whether two ids are one real series. */
function titleKey(title: string): string {
	return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * One real series, which may span several `recurring_event_id`s: Google mints
 * a new id when a meeting is recreated, rescheduled, or split, and the old
 * occurrences keep the old one. Grouping by title keeps that history together
 * so a folder full of one meeting's notes isn't read as two rival series.
 */
interface SeriesGroup {
	title: string;
	count: number;
	/** Newest *valid* date seen, and the id that note carried. */
	newest: Date | null;
	newestId: string | null;
	/** Every `seriesKey` in this group — what makes merging and outlier checks id-based. */
	ids: Set<string>;
	/** Raw id -> how many notes carried it, for the all-undated fallback. */
	idCounts: Map<string, number>;
}

/**
 * The id new occurrences carry. The newest dated note wins, so a recreated or
 * rescheduled series takes over from its first occurrence. With no usable date
 * anywhere in the group, the most common id wins rather than whichever note the
 * vault scan happened to reach first.
 */
function currentIdOf(group: SeriesGroup): string {
	if (group.newestId) return group.newestId;
	let best = "";
	let bestCount = -1;
	for (const [id, count] of group.idCounts) {
		if (count > bestCount) {
			best = id;
			bestCount = count;
		}
	}
	return best;
}

/** A date we can actually order by — `parseStampDate` returns Invalid Date for a malformed stamp. */
function usableDate(date: Date | null | undefined): Date | null {
	return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * Groups a folder's tagged notes into real series and 1:1s, for *diagnosis
 * only* — `inferIdentityFromSiblings`, which feeds the fix commands that write
 * frontmatter, keeps its stricter id-based rule.
 *
 * Grouping starts from the title (a recreated series keeps its name but gets a
 * new id) and is then widened by id: any two groups sharing a `seriesKey` are
 * merged. That second step matters because a note's title is *not* rewritten
 * when it's tagged — `applyMetadataFix` writes only the id — so an ad-hoc or
 * imported note keeps its own basename as a title while carrying the folder's
 * correct id. Without the merge it would form its own group and be reported as
 * mistagged against itself, with the same id on both sides, and the wrench
 * could never clear it.
 *
 * Deliberate blind spot: a genuinely foreign id hiding under a matching title
 * is not flagged. Same-titled series are common ("Standup", "Team sync"), and
 * the alternative re-creates the noise this grouping exists to remove.
 */
function groupFolderIdentities(rows: NoteIdentityRow[]): {
	oneOnOnes: OneOnOneCandidate[];
	series: SeriesGroup[];
} {
	const oneOnOnes = new Map<string, OneOnOneCandidate>();
	const byTitle = new Map<string, SeriesGroup>();
	for (const row of rows) {
		// Same precedence countCandidates uses: a recurring 1:1 counts as a 1:1.
		if (row.oneOnOneWith) {
			const key = row.oneOnOneEmail ?? row.oneOnOneWith.trim().toLowerCase();
			const existing = oneOnOnes.get(key);
			if (existing) existing.count++;
			else {
				oneOnOnes.set(key, {
					name: row.oneOnOneWith,
					email: row.oneOnOneEmail,
					count: 1,
				});
			}
			continue;
		}
		if (!row.recurringEventId) continue;
		const id = row.recurringEventId;
		const key = titleKey(row.title) || `id:${seriesKey(id)}`;
		const date = usableDate(row.date);
		const existing = byTitle.get(key);
		if (!existing) {
			byTitle.set(key, {
				title: row.title,
				count: 1,
				newest: date,
				newestId: date ? id : null,
				ids: new Set([seriesKey(id)]),
				idCounts: new Map([[id, 1]]),
			});
			continue;
		}
		existing.count++;
		existing.ids.add(seriesKey(id));
		existing.idCounts.set(id, (existing.idCounts.get(id) ?? 0) + 1);
		// An undated note never displaces a dated one, in either scan order.
		if (date && (!existing.newest || date > existing.newest)) {
			existing.newest = date;
			existing.newestId = id;
		}
	}

	// Widen by id: two titles that share a series are one series.
	const merged: SeriesGroup[] = [];
	for (const group of byTitle.values()) {
		const target = merged.find((m) => [...group.ids].some((id) => m.ids.has(id)));
		if (!target) {
			merged.push(group);
			continue;
		}
		target.count += group.count;
		for (const id of group.ids) target.ids.add(id);
		for (const [id, count] of group.idCounts) {
			target.idCounts.set(id, (target.idCounts.get(id) ?? 0) + count);
		}
		if (group.newest && (!target.newest || group.newest > target.newest)) {
			target.newest = group.newest;
			target.newestId = group.newestId;
			// The surviving title follows the newest note, so labels name the
			// series as it is called now.
			target.title = group.title;
		}
	}
	return { oneOnOnes: [...oneOnOnes.values()], series: merged };
}

/** The identity a group stands for, carrying the id new occurrences use. */
function groupIdentity(group: SeriesGroup): InferredIdentity {
	return {
		kind: "recurring",
		recurringEventId: currentIdOf(group),
		title: group.title,
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
		const { oneOnOnes, series } = groupFolderIdentities(tagged);
		const candidates = [
			...oneOnOnes.map((c) => ({
				key: `1:1:${c.email ?? c.name.trim().toLowerCase()}`,
				group: null as SeriesGroup | null,
				identity: {
					kind: "one-on-one",
					name: c.name,
					email: c.email,
				} as InferredIdentity,
				count: c.count,
			})),
			...series.map((g) => ({
				key: `series:${currentIdOf(g)}`,
				group: g,
				identity: groupIdentity(g),
				count: g.count,
			})),
		];
		if (candidates.length === 0) continue;

		const [top, runnerUp] = [...candidates].sort((a, b) => b.count - a.count);
		// A real tie between two *different* identities: nothing can be called
		// the folder's, so every note is suspect until a human sorts it out.
		if (candidates.length > 1 && top!.count === runnerUp!.count) {
			for (const row of folderRows) {
				issues.push({
					path: row.path,
					title: row.fileTitle,
					folder,
					reason: {
						kind: "ambiguous",
						oneOnOnes,
						recurring: series.map((g) => ({
							recurringEventId: currentIdOf(g),
							title: g.title,
							count: g.count,
						})),
					},
				});
			}
			continue;
		}
		const expected = top!.identity;
		if (expected.kind === "one-on-one" && !oneOnOneSeparately) continue;

		for (const row of untagged) {
			issues.push({
				path: row.path,
				title: row.fileTitle,
				folder,
				reason: { kind: "missing", identity: expected },
			});
		}

		const topGroup = top!.group;
		for (const row of tagged) {
			// Id first: a note carrying an id the winning series already owns is
			// never a mistag, whatever its title says (the fix command writes the
			// id and leaves the title alone, so titles drift legitimately).
			if (row.recurringEventId && topGroup?.ids.has(seriesKey(row.recurringEventId))) {
				continue;
			}
			if (row.oneOnOneWith && top!.identity.kind === "one-on-one") {
				const key = row.oneOnOneEmail ?? row.oneOnOneWith.trim().toLowerCase();
				if (key === (top!.identity.email ?? top!.identity.name.trim().toLowerCase())) {
					continue;
				}
			}
			const own = majorityIdentity([toSibling(row)]);
			if (own.kind !== "resolved") continue;
			issues.push({
				path: row.path,
				title: row.fileTitle,
				folder,
				reason: { kind: "outlier", actual: own.identity, expected },
			});
		}
	}
	return issues;
}
