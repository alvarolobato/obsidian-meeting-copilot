export interface FilterableEvent {
	summary: string;
	allDay: boolean;
}

/** Splits a free-text keyword box (newlines and/or commas) into trimmed, non-empty keywords. */
export function parseKeywords(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((k) => k.trim())
		.filter((k) => k.length > 0);
}

/**
 * Records every timed event whose title does NOT contain any exclusion keyword.
 * All-day events are never recorded.
 */
export function shouldRecord(event: FilterableEvent, exclusionKeywords: string[]): boolean {
	if (event.allDay) return false;
	const title = event.summary.toLowerCase();
	return !exclusionKeywords.some((k) => {
		const kw = k.trim().toLowerCase();
		return kw.length > 0 && title.includes(kw);
	});
}
