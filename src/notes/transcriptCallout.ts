/**
 * Single source of truth for the collapsed transcript callout, shared by its
 * writer (`meetingNote.ts`: `formatTranscriptCallout`) and the section/callout
 * parsers (`enrichedBlock.ts`: `extractSection`, `extractTranscript`). Keeping
 * the title and its marker regex here stops the writer and readers from drifting
 * apart — the parser-drift bug class called out in #20.
 */

/** Title shown on the collapsed transcript callout. */
export const TRANSCRIPT_CALLOUT_TITLE = "Transcript";

/** Escapes a literal string for safe embedding inside a RegExp. */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches the collapsed transcript callout's marker line, e.g.
 * `> [!quote]- Transcript`. The callout has no markdown heading of its own and
 * is pinned at the note's bottom, so it sits inside the trailing section's
 * extent; section parsers must treat this line as a terminator or the callout
 * gets swallowed into that section (#20).
 */
export const TRANSCRIPT_CALLOUT_MARKER = new RegExp(
	`^>\\s*\\[![\\w-]+\\][+-]?\\s*${escapeRegExp(TRANSCRIPT_CALLOUT_TITLE)}\\s*$`
);
