/**
 * Turns an email address into a human-friendly name for folder/label use, e.g.
 * "sophie.smith@acme.com" → "Sophie Smith". Only a fallback for attendees that
 * carry no display name — we never want a raw address as a 1:1 folder name.
 */
export function humanizeEmailName(email: string): string {
	const local = (email.split("@")[0] ?? "").trim();
	const words = local
		.split(/[._+-]+/)
		.map((w) => w.trim())
		.filter((w) => w.length > 0)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
	return words.join(" ") || email.trim();
}
