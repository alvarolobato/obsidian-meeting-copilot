/**
 * Google splits a recurring series' lineage whenever an occurrence is
 * edited with "this and following events" (or similar): every instance
 * from that point on gets a *new* `recurringEventId`, formed by appending
 * `_R<start timestamp>` to the previous lineage's id (e.g.
 * `2ic6u9p8r1rlhvfv7k35u2716s` becomes
 * `2ic6u9p8r1rlhvfv7k35u2716s_R20260730T140000`). To a human this still
 * reads as one continuous weekly meeting; to anything comparing raw
 * `recurringEventId` strings it looks like two, three, or more unrelated
 * series. The suffix is unambiguous to detect: real ids are base32hex
 * (lowercase `a`-`v` and digits only, per Google's own id-format
 * documentation), so the first `_` can only be the start of an appended
 * suffix, never part of the id itself.
 *
 * Use this to compare/group recurring notes ("is this the same series as
 * that one"); never to decide what to *write* — a note's frontmatter should
 * keep whatever exact id Google reported for its own occurrence.
 */
export function seriesKey(recurringEventId: string): string {
	const idx = recurringEventId.indexOf("_");
	return idx === -1 ? recurringEventId : recurringEventId.slice(0, idx);
}
