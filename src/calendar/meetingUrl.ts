/**
 * Recognises links to the conferencing providers we support. These patterns are
 * intentionally specific to each provider's join-URL shape so that scanning
 * free-text (a calendar location or description) doesn't accidentally pick up an
 * unrelated link such as an agenda doc.
 */
const JOIN_URL_MATCHERS: readonly RegExp[] = [
	// Microsoft Teams (work/school, consumer, and government tenants).
	/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i,
	/https:\/\/teams\.live\.com\/meet\/[^\s"'<>]+/i,
	/https:\/\/teams\.microsoft\.us\/l\/meetup-join\/[^\s"'<>]+/i,
	// Zoom (commercial + government), covering /j, /my, /w and /s paths.
	/https:\/\/(?:[a-z0-9-]+\.)*zoom\.us\/(?:j|my|w|s)\/[^\s"'<>]+/i,
	/https:\/\/(?:[a-z0-9-]+\.)*zoomgov\.com\/(?:j|my|w|s)\/[^\s"'<>]+/i,
	// Google Meet.
	/https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/i,
	// Cisco Webex.
	/https:\/\/[a-z0-9.-]*webex\.com\/(?:meet|wbxmjs|join)\/[^\s"'<>]+/i,
	// GoTo Meeting (legacy + current domains).
	/https:\/\/(?:[\w.-]+\.)?gotomeeting\.com\/join\/[^\s"'<>]+/i,
	/https:\/\/(?:[\w.-]+\.)?goto\.com\/meet\/[^\s"'<>]+/i,
	// Whereby.
	/https:\/\/whereby\.com\/[a-zA-Z0-9_-]+(?:\?[^\s"'<>]*)?/i,
	// Amazon Chime.
	/https:\/\/(?:[\w.-]+\.)?chime\.aws\/(?:meetings|portal\/meetings)\/[^\s"'<>]+/i,
];

/**
 * Returns the first recognised conferencing URL found across `texts`, or `null`.
 *
 * This is a fallback for events that lack structured conferencing data
 * (`conferenceData` / `hangoutLink`); it deliberately only matches known
 * providers rather than any URL, so descriptions full of doc links don't get
 * mistaken for a join link.
 */
export function extractMeetingUrlFromText(
	...texts: Array<string | null | undefined>
): string | null {
	for (const text of texts) {
		if (!text) continue;
		for (const matcher of JOIN_URL_MATCHERS) {
			const found = text.match(matcher);
			if (found) return found[0];
		}
	}
	return null;
}
