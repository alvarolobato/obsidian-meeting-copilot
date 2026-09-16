/**
 * When the shared OpenAI-compatible endpoint counts as configured.
 *
 * Kept pure (no Obsidian imports) and used by *both* the welcome screen's
 * status pill and the enrichment gates in main.ts, so the two can't disagree —
 * a pill reading "Ready" while enrichment refuses to run is worse than either
 * answer on its own.
 */

/** True for an http(s) URL served by this machine (localhost, 127.x, ::1). */
export function isLoopbackUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
		return (
			host === "localhost" ||
			host.endsWith(".localhost") ||
			host === "::1" ||
			/^127\./.test(host)
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
	const url = c.apiBaseUrl.trim();
	if (!url || !c.enrichModel.trim()) return false;
	return Boolean(c.apiKey.trim()) || isLoopbackUrl(url);
}
