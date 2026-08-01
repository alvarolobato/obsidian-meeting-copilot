/**
 * Pure logic for inferring a note's 1:1 or recurring-series identity from its
 * sibling notes — used both when a note is auto-detected moving into a folder
 * and by the manual "Fix meeting metadata" command/menu items. Kept
 * Obsidian-free so it's testable without a vault; the sibling scan and the
 * actual frontmatter write happen in the plugin.
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

/**
 * Infers a single, unambiguous identity from a folder's siblings: the same
 * 1:1 partner (matched by email when known, else by name) or the same
 * recurring series (`recurring_event_id`) across every identified sibling.
 * Returns `null` when there's no signal (no identified siblings) or the
 * folder mixes more than one identity — safer to say nothing than guess
 * wrong when a folder isn't cleanly one person/series.
 */
export function inferIdentityFromSiblings(
	siblings: SiblingIdentity[]
): InferredIdentity | null {
	const oneOnOnes = new Map<string, { name: string; email: string | null }>();
	const recurring = new Map<string, string>();
	for (const s of siblings) {
		// A note can legitimately carry both (a recurring 1:1) — 1:1 identity
		// wins, same priority the agenda's own accent classification uses, so
		// one sibling contributes evidence for exactly one bucket rather than
		// looking like a mixed/ambiguous folder.
		if (s.oneOnOneWith) {
			const key = s.oneOnOneEmail ?? s.oneOnOneWith.trim().toLowerCase();
			if (!oneOnOnes.has(key)) {
				oneOnOnes.set(key, { name: s.oneOnOneWith, email: s.oneOnOneEmail });
			}
		} else if (s.recurringEventId) {
			if (!recurring.has(s.recurringEventId)) {
				recurring.set(s.recurringEventId, s.title);
			}
		}
	}

	if (oneOnOnes.size + recurring.size !== 1) return null;
	if (oneOnOnes.size === 1) {
		const identity = [...oneOnOnes.values()][0]!;
		return { kind: "one-on-one", name: identity.name, email: identity.email };
	}
	const [recurringEventId, title] = [...recurring.entries()][0]!;
	return { kind: "recurring", recurringEventId, title };
}
