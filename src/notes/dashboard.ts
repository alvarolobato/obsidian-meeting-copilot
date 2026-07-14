/** Markers delimiting the plugin-managed Dataview block in the dashboard note. */
export const DASHBOARD_START = "%% meeting-copilot:dashboard %%";
export const DASHBOARD_END = "%% /meeting-copilot:dashboard %%";

/** Fenced code-block language rendered by the plugin's "Needs attention" processor. */
export const ATTENTION_BLOCK_LANG = "meeting-copilot-attention";

/**
 * Builds the managed Dataview block (upcoming / past meetings + open action
 * items). Deliberately vault-wide — no `FROM` — since meeting notes can live
 * under any of several folders (per-series, per-1:1, ad-hoc, or wherever the
 * user moved them); scoping to one folder would miss most of them. Queries
 * match `event_id` (plugin-owned) or `meeting_url` (legacy/manual meeting
 * notes the pre-template dashboard also listed). The task query reads the
 * fields via `file.frontmatter` because tasks stopped inheriting page fields
 * in newer Dataview releases. Pure so it can be tested without a vault.
 */
export function buildDashboardBlock(): string {
	// Two Dataview gotchas govern the upcoming/past split:
	//
	// 1. The current instant is the literal `date(now)` — a bare `now` is NOT a
	//    keyword, so Dataview reads it as the (missing) field `now` = null.
	//    `date(start) >= null` is true for *every* row under Dataview's
	//    cross-type/null ordering, so a bare `now` dumped all past meetings into
	//    "Upcoming" and left "Past" empty. `date(now)` includes the time (unlike
	//    `date(today)`, which is midnight), so same-day meetings that already
	//    ended correctly fall under Past.
	// 2. `start` is wrapped in `date()` everywhere it's compared, sorted, or
	//    rendered. The frontmatter value is a local ISO stamp (e.g.
	//    "2026-07-14T05:00:15"); `date()` forces the parse so the comparison is
	//    chronological, and is a no-op when Dataview already coerced it. The
	//    leading `date(start)` truthiness check drops meeting notes that have no
	//    `start` at all (some legacy `meeting_url` notes) so a null start can't
	//    be miscategorised into either bucket.
	const cols =
		"TABLE WITHOUT ID file.link AS Meeting, " +
		'dateformat(date(start), "yyyy-MM-dd HH:mm") AS Date, status AS Status, ' +
		'choice(recording, "🎙️", "") AS Rec';
	return [
		DASHBOARD_START,
		"## Upcoming meetings",
		"```dataview",
		cols,
		"WHERE (event_id OR meeting_url) AND date(start) AND date(start) >= date(now)",
		"SORT date(start) ASC",
		"```",
		"",
		"## Past meetings",
		"```dataview",
		cols,
		"WHERE (event_id OR meeting_url) AND date(start) AND date(start) < date(now)",
		"SORT date(start) DESC",
		"```",
		"",
		"## Open action items",
		"```dataview",
		"TASK WHERE !completed AND (file.frontmatter.event_id OR file.frontmatter.meeting_url)",
		"GROUP BY file.link",
		"```",
		"",
		"## Needs attention",
		// Rendered by the plugin: meetings that haven't finished the
		// scheduled → recorded → transcribed → enriched pipeline, with buttons.
		"```" + ATTENTION_BLOCK_LANG,
		"```",
		DASHBOARD_END,
	].join("\n");
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inserts or replaces the managed dashboard block in existing content, leaving
 * anything the user added around the markers untouched. Pure/testable.
 */
export function withDashboardBlock(content: string, block: string): string {
	const re = new RegExp(
		`${escapeRegExp(DASHBOARD_START)}[\\s\\S]*?${escapeRegExp(DASHBOARD_END)}`
	);
	if (re.test(content)) return content.replace(re, block);
	const trimmed = content.replace(/\s+$/, "");
	return `${trimmed.length ? `${trimmed}\n\n` : ""}${block}\n`;
}
