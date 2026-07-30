import type { AgendaMeeting } from "../agendaModel";

/**
 * Which accent colour an event's bar / status dot uses. Categories share one
 * chroma/lightness family and vary only by hue (see the accent tokens in
 * `styles.css`), so the palette reads as one system.
 */
export type AccentKey = "live" | "meeting" | "personal" | "block";

/** Categorises a meeting for its accent colour (a live/imminent one overrides). */
export function accentFor(m: AgendaMeeting): AccentKey {
	if (m.recurringEventId) return "meeting";
	if (m.oneOnOnePartner) return "personal";
	if (m.attendees.length <= 1) return "block";
	return "meeting";
}

/** The CSS class that paints an element with the given accent. */
export function accentClass(key: AccentKey): string {
	return `mc-cal-accent-${key}`;
}
