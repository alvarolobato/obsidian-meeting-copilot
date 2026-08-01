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
 * (`recurring_event_id`) across every identified sibling. `"ambiguous"`
 * carries every distinct candidate found, so the caller can tell the user
 * exactly what disagrees instead of just refusing to guess.
 */
export function inferIdentityFromSiblings(
	siblings: SiblingIdentity[]
): IdentityInference {
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
			const existing = recurring.get(s.recurringEventId);
			if (existing) existing.count++;
			else {
				recurring.set(s.recurringEventId, {
					recurringEventId: s.recurringEventId,
					title: s.title,
					count: 1,
				});
			}
		}
	}

	const oneOnOneList = [...oneOnOnes.values()];
	const recurringList = [...recurring.values()];
	if (oneOnOneList.length === 0 && recurringList.length === 0) {
		return { kind: "none" };
	}
	if (oneOnOneList.length === 1 && recurringList.length === 0) {
		const c = oneOnOneList[0]!;
		return {
			kind: "resolved",
			identity: { kind: "one-on-one", name: c.name, email: c.email },
		};
	}
	if (recurringList.length === 1 && oneOnOneList.length === 0) {
		const c = recurringList[0]!;
		return {
			kind: "resolved",
			identity: {
				kind: "recurring",
				recurringEventId: c.recurringEventId,
				title: c.title,
			},
		};
	}
	return { kind: "ambiguous", oneOnOnes: oneOnOneList, recurring: recurringList };
}
