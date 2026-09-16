/**
 * When the shared OpenAI-compatible endpoint counts as configured.
 *
 * Kept pure (no Obsidian imports) and used by *both* the welcome screen's
 * status pill and the enrichment gates in main.ts, so the two can't disagree —
 * a pill reading "Ready" while enrichment refuses to run is worse than either
 * answer on its own.
 */

/**
 * True only for a genuine IPv4 loopback address. A prefix test would accept
 * `127.0.0.1.attacker.example`, which is a remote host — and since loopback
 * waives the API-key requirement, that would hand a remote endpoint keyless
 * access to transcripts.
 */
function isLoopbackIpv4(host: string): boolean {
	const parts = host.split(".");
	if (parts.length !== 4) return false;
	if (!parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false;
	return Number(parts[0]) === 127;
}

/** True for an http(s) URL served by this machine (localhost, 127.0.0.0/8, ::1). */
export function isLoopbackUrl(url: string): boolean {
	try {
		const { protocol, hostname } = new URL(url);
		if (protocol !== "http:" && protocol !== "https:") return false;
		// The URL parser normalises shorthand and case (http://127.1 -> 127.0.0.1)
		// and brackets IPv6 hosts, so match on what it produced.
		const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
		return (
			host === "localhost" ||
			host.endsWith(".localhost") ||
			host === "::1" ||
			isLoopbackIpv4(host)
		);
	} catch {
		return false;
	}
}

/** The endpoint settings the rule below reads. */
export interface ApiEnrichConfig {
	apiBaseUrl: string;
	apiKey: string;
	enrichModel: string;
}

/**
 * A URL and a model are always required. A key is required too, *unless* the
 * endpoint runs on this machine: local servers (Ollama, LM Studio) legitimately
 * ignore auth, `fetchModelIds` already omits the header when the key is empty,
 * and the settings copy offers keyless local use.
 */
export function apiEnrichConfigured(c: ApiEnrichConfig): boolean {
	// data.json is merged as-is, so these can be anything a hand edit left
	// behind; a non-string must read as "unconfigured", never throw.
	const text = (value: unknown): string =>
		typeof value === "string" ? value.trim() : "";
	const url = text(c.apiBaseUrl);
	if (!url || !text(c.enrichModel)) return false;
	return Boolean(text(c.apiKey)) || isLoopbackUrl(url);
}
