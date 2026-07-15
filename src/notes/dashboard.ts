/** Markers delimiting the plugin-managed Dataview block in the dashboard note. */
export const DASHBOARD_START = "%% meeting-copilot:dashboard %%";
export const DASHBOARD_END = "%% /meeting-copilot:dashboard %%";

/** Fenced code-block language rendered by the plugin's "Needs attention" processor. */
export const ATTENTION_BLOCK_LANG = "meeting-copilot-attention";

/** Fenced code-block language rendered by the plugin's paginated "Upcoming meetings" processor. */
export const UPCOMING_BLOCK_LANG = "meeting-copilot-upcoming";

/** Fenced code-block language rendered by the plugin's paginated "Past meetings" processor. */
export const PAST_BLOCK_LANG = "meeting-copilot-past";

/**
 * Builds the managed dashboard block. "Upcoming meetings" and "Past meetings"
 * are plugin-rendered blocks (not Dataview): each merges the vault's meeting
 * notes with the calendar events the agenda already loads, so meetings without
 * a note yet still appear (with a "create note" action), and each offers a
 * per-page dropdown + pagination — none of which a Dataview `TABLE` can do.
 * "Open action items" stays on Dataview (a vault-wide task query, gated to
 * meeting notes by `event_id`/`meeting_url`; it reads the fields via
 * `file.frontmatter` because tasks stopped inheriting page fields in newer
 * Dataview releases). "Needs attention" is likewise plugin-rendered. Pure so it
 * can be tested without a vault.
 */
export function buildDashboardBlock(): string {
	return [
		DASHBOARD_START,
		"## Upcoming meetings",
		// Rendered by the plugin: calendar events + noted meetings, soonest
		// first, with a per-page dropdown and pagination.
		"```" + UPCOMING_BLOCK_LANG,
		"```",
		"",
		"## Past meetings",
		// Rendered by the plugin: calendar events + noted meetings, newest
		// first, with a per-page dropdown and pagination.
		"```" + PAST_BLOCK_LANG,
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
