/**
 * Pure logic for the dashboard's action / follow-up sections: order the notes
 * that carry open tasks newest-first (by the note's origin date) so the most
 * recent meetings surface at the top. Kept Obsidian-free so it can be
 * unit-tested without a vault; the vault scan (which notes have open tasks, and
 * their text) happens in the plugin, which hands the flattened groups here.
 * Pagination is shared with the meetings tables (see `dashboardMeetings`).
 */

import { TRANSCRIPT_CALLOUT_MARKER } from "./transcriptCallout";
import { parseStampDate } from "./meetingNote";

export interface ActionTask {
	/** The task text with the `- [ ]` prefix (and any `✅` / `➕` date) stripped. */
	text: string;
	/** The full original line, used to locate the task when toggling it done. */
	raw: string;
	/** 0-based line index of the task in its note at scan time. */
	line: number;
	/**
	 * True for a task completed within its grace period (kept in the list a
	 * little longer so a just-ticked item doesn't vanish). Rendered checked and
	 * struck through, and excluded from the "open action items" count.
	 */
	done: boolean;
	/**
	 * Owner name parsed from a leading `**Name:**` / `**Name**:` prefix, or null
	 * when the task is unassigned / personal.
	 */
	owner: string | null;
	/**
	 * Creation date from a Tasks-plugin `➕ YYYY-MM-DD` stamp, when present.
	 * Used for age / horizon filtering; null when the line has no stamp.
	 */
	created: Date | null;
}

export interface ActionNoteGroup {
	path: string;
	title: string;
	/** The note's origin date (frontmatter/filename/mtime); null when unknown. */
	date: Date | null;
	tasks: ActionTask[];
}

/**
 * Returns the groups that actually have open tasks, ordered by note date
 * (newest first). Groups without a date sort last, and ties break on the path
 * so the order is stable rather than dependent on scan order.
 */
export function sortActionNoteGroups(
	groups: ActionNoteGroup[]
): ActionNoteGroup[] {
	return groups
		.filter((g) => g.tasks.length > 0)
		.sort((a, b) => {
			const at = a.date?.getTime() ?? Number.NEGATIVE_INFINITY;
			const bt = b.date?.getTime() ?? Number.NEGATIVE_INFINITY;
			if (bt !== at) return bt - at;
			return a.path.localeCompare(b.path);
		});
}

/** Total *open* tasks across all groups (recently-done ones don't count). */
export function countTasks(groups: ActionNoteGroup[]): number {
	return groups.reduce(
		(sum, g) => sum + g.tasks.filter((task) => !task.done).length,
		0
	);
}

const OPEN_TASK_RE = /^\s*[-*+]\s+\[ \]/;
const DONE_TASK_RE = /^\s*[-*+]\s+\[[xX]\]/;
const DONE_DATE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const CREATED_DATE_RE = /➕\s*(\d{4}-\d{2}-\d{2})/;

/**
 * Splits a leading bold owner prefix (`**Kate:**` / `**Kate**:`) from task
 * display text. Returns the remainder as `body` (may still include markdown).
 * Pure/testable.
 */
export function parseTaskOwner(text: string): {
	owner: string | null;
	body: string;
} {
	const m = text.match(/^\*\*([^*]+)\*\*:?\s*(.*)$/);
	if (!m) return { owner: null, body: text };
	const owner = (m[1] ?? "").replace(/:+\s*$/, "").trim();
	const body = (m[2] ?? "").trim();
	if (!owner) return { owner: null, body: text };
	return { owner, body: body.length ? body : text };
}

/**
 * The display text for a task line, stripping — in order — the list marker +
 * checkbox, a trailing block reference (`^id`, which Obsidian pins to the very
 * end, after dates), then the `✅ YYYY-MM-DD` completion date and `➕ YYYY-MM-DD`
 * creation date now left at the end. Ref-first means a task completed with a
 * block ref shows neither the date nor the ref in the list.
 */
export function cleanTaskText(raw: string): string {
	return raw
		.replace(/^\s*[-*+]\s+\[[^\]]\]\s*/, "")
		.replace(/\s*\^[A-Za-z0-9-]+\s*$/, "")
		.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
		.replace(/\s*➕\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Parses task lines from a note body (or a single section body) into action
 * tasks: every open (`- [ ]`) task, plus any done (`- [x]`) task whose
 * `✅ YYYY-MM-DD` completion date equals `todayStamp` — kept in its grace
 * period until that day is over so a just-ticked item doesn't vanish.
 * Pure/testable; the vault read happens in the plugin.
 *
 * When `sectionHeading` is set (e.g. `"## Action items"`), only lines inside
 * that `##` section are considered — so personal actions and meeting follow-ups
 * can be scanned separately. Without a heading, the whole body is scanned
 * (legacy / tests).
 */
export function parseNoteTasks(
	content: string,
	todayStamp: string,
	sectionHeading?: string
): ActionTask[] {
	const body = sectionHeading
		? extractHeadingBody(content, sectionHeading)
		: content;
	if (sectionHeading && body === null) return [];

	const tasks: ActionTask[] = [];
	const lines = (body ?? content).split("\n");
	// When scoped to a section, line indexes must still point into the *full*
	// note so toggling done can locate the raw line. Compute the section's
	// start offset in the original content.
	const lineOffset = sectionHeading
		? sectionStartLine(content, sectionHeading)
		: 0;

	lines.forEach((raw, i) => {
		const line = lineOffset + i;
		if (OPEN_TASK_RE.test(raw)) {
			const cleaned = cleanTaskText(raw);
			const { owner } = parseTaskOwner(cleaned);
			tasks.push({
				line,
				raw,
				// Keep the full cleaned line (including **Owner:**) so the
				// dashboard can render bold owners via MarkdownRenderer.
				text: cleaned,
				done: false,
				owner,
				created: createdDateOf(raw),
			});
			return;
		}
		if (DONE_TASK_RE.test(raw)) {
			const m = raw.match(DONE_DATE_RE);
			if (m && m[1] === todayStamp) {
				const cleaned = cleanTaskText(raw);
				const { owner } = parseTaskOwner(cleaned);
				tasks.push({
					line,
					raw,
					text: cleaned,
					done: true,
					owner,
					created: createdDateOf(raw),
				});
			}
		}
	});
	return tasks;
}

/** Creation date from a `➕ YYYY-MM-DD` stamp on the raw line, else null. */
function createdDateOf(raw: string): Date | null {
	const m = raw.match(CREATED_DATE_RE);
	if (!m?.[1]) return null;
	const d = parseStampDate(m[1]);
	return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Body of a `## Heading` section (until the next same-or-higher heading), or
 * `null` when the heading is absent. Does not trim — line offsets must match
 * the source. Stops before a collapsed transcript callout the same way
 * `extractSection` does, but returns raw lines including blanks.
 */
function extractHeadingBody(
	content: string,
	heading: string
): string | null {
	const lines = content.split("\n");
	const h = heading.trim();
	const start = lines.findIndex((l) => l.trim() === h);
	if (start === -1) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (/^#{1,2}\s/.test(line) || TRANSCRIPT_CALLOUT_MARKER.test(line)) {
			end = i;
			break;
		}
	}
	return lines.slice(start + 1, end).join("\n");
}

/** 0-based line index of the first body line under `heading`, or 0. */
function sectionStartLine(content: string, heading: string): number {
	const lines = content.split("\n");
	const h = heading.trim();
	const start = lines.findIndex((l) => l.trim() === h);
	return start === -1 ? 0 : start + 1;
}

/**
 * Age of a task in whole days relative to `today` (local calendar). Prefers the
 * `➕` creation stamp; falls back to the note's origin date. `null` when neither
 * is known (caller should treat as "in horizon" / unageable).
 */
export function taskAgeDays(
	task: ActionTask,
	noteDate: Date | null,
	today: Date
): number | null {
	const origin = task.created ?? noteDate;
	if (!origin) return null;
	const start = Date.UTC(
		origin.getFullYear(),
		origin.getMonth(),
		origin.getDate()
	);
	const end = Date.UTC(
		today.getFullYear(),
		today.getMonth(),
		today.getDate()
	);
	return Math.max(0, Math.round((end - start) / 86_400_000));
}

export interface HorizonSplit {
	/** Groups/tasks within the horizon (or with unknown age). */
	recent: ActionNoteGroup[];
	/** Groups/tasks older than the horizon. */
	older: ActionNoteGroup[];
}

/**
 * Splits action groups into recent vs older by {@link taskAgeDays}. A horizon
 * of `0` (or negative) means "no filter" — everything is recent. Tasks with
 * unknown age stay in `recent` so they aren't silently hidden. Empty groups
 * after filtering are dropped. Pure/testable.
 */
export function splitByHorizon(
	groups: ActionNoteGroup[],
	horizonDays: number,
	today: Date
): HorizonSplit {
	if (horizonDays <= 0) {
		return { recent: groups, older: [] };
	}
	const recent: ActionNoteGroup[] = [];
	const older: ActionNoteGroup[] = [];
	for (const g of groups) {
		const recentTasks: ActionTask[] = [];
		const olderTasks: ActionTask[] = [];
		for (const task of g.tasks) {
			const age = taskAgeDays(task, g.date, today);
			if (age !== null && age > horizonDays) olderTasks.push(task);
			else recentTasks.push(task);
		}
		if (recentTasks.length) recent.push({ ...g, tasks: recentTasks });
		if (olderTasks.length) older.push({ ...g, tasks: olderTasks });
	}
	return { recent, older };
}
