import type { LanguageDictionaries } from "./vendor/ApiSettings";

function empty(): LanguageDictionaries {
	return {
		ja: { definiteCorrections: [], contextualCorrections: [] },
		en: { definiteCorrections: [], contextualCorrections: [] },
		zh: { definiteCorrections: [], contextualCorrections: [] },
		ko: { definiteCorrections: [], contextualCorrections: [] },
	};
}

/**
 * Parses the user's plain-text dictionary into the vendored engine's structure.
 *
 * Each non-empty, non-comment line is `misheard => correct`. Multiple source
 * spellings can share one target with `a | b => correct`.
 *
 * The engine picks a dictionary by the transcription language. Rules here are
 * language-agnostic name/term fixes, so they're mirrored into every bucket.
 * The auto-language path reads only the `en` bucket (canonical) to avoid
 * duplicating rules; all buckets are identical, so any one is sufficient.
 */
export function parseDictionary(raw: string): LanguageDictionaries {
	const dict = empty();
	if (!raw) return dict;
	const buckets = [dict.en, dict.ja, dict.zh, dict.ko];
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const idx = trimmed.indexOf("=>");
		if (idx === -1) continue;
		const to = trimmed.slice(idx + 2).trim();
		const from = trimmed
			.slice(0, idx)
			.split("|")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (from.length === 0 || !to) continue;
		for (const bucket of buckets) {
			bucket.definiteCorrections.push({ from: [...from], to });
		}
	}
	return dict;
}
