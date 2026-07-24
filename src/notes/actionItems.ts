/** Heading (## or ###) that holds the participant's own action items in enriched output. */
const ACTION_HEADING =
	/^#{2,3}\s+(next steps|action items|actions|to[- ]?dos?)\s*$/i;

/** Heading (## or ###) that holds meeting-wide follow-ups in enriched output. */
const FOLLOWUP_HEADING = /^#{2,3}\s+follow[- ]?ups?\s*$/i;

/** Matches a markdown task line, e.g. `- [ ] foo`, `* [x] bar`, or `1. [ ] baz`. */
const TASK_LINE = /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]\s+/;

/** Tasks-plugin creation-date stamp (`➕ YYYY-MM-DD`). */
const CREATED_DATE_RE = /➕\s*\d{4}-\d{2}-\d{2}/;

export interface ExtractedActions {
	/** Action items rendered as `- [ ] …` task lines (top-level items only). */
	items: string[];
	/** The input markdown with the action-items section removed. */
	without: string;
}

/**
 * Pulls a heading-matched section out of enriched markdown, converting its
 * top-level bullets into obsidian-tasks checkboxes and returning the markdown
 * with that section stripped (so it isn't duplicated inside the AI callout).
 * Indented sub-bullets are treated as context and left out of the task list.
 */
function extractSectionTasks(
	markdown: string,
	headingRe: RegExp
): ExtractedActions {
	const lines = markdown.split("\n");
	const start = lines.findIndex((l) => headingRe.test(l.trim()));
	if (start === -1) return { items: [], without: markdown };

	const level = (lines[start] ?? "").match(/^#+/)?.[0].length ?? 3;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const m = (lines[i] ?? "").match(/^(#+)\s/);
		if (m && (m[1]?.length ?? 0) <= level) {
			end = i;
			break;
		}
	}

	const items: string[] = [];
	for (const raw of lines.slice(start + 1, end)) {
		// Only top-level bullets become tasks; indented lines are supporting detail.
		if (/^\s+/.test(raw)) continue;
		// Accept both unordered ("- ", "* ") and ordered ("1. ") list items.
		const m = raw.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
		if (!m) continue;
		const text = (m[1] ?? "").replace(/^\[[ xX]\]\s*/, "").trim();
		if (text) items.push(`- [ ] ${text}`);
	}

	const without = [...lines.slice(0, start), ...lines.slice(end)]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { items, without };
}

/**
 * Pulls the participant's own action-items section (`### Next steps` / Action
 * items / Actions / To-dos) out of enriched markdown. Meeting-wide
 * `### Follow-ups` is intentionally excluded — use {@link extractFollowUps}.
 */
export function extractActionItems(markdown: string): ExtractedActions {
	return extractSectionTasks(markdown, ACTION_HEADING);
}

/**
 * Pulls the meeting-wide follow-ups section out of enriched markdown.
 * Participant-owned `### Next steps` items are left alone — use
 * {@link extractActionItems}.
 */
export function extractFollowUps(markdown: string): ExtractedActions {
	return extractSectionTasks(markdown, FOLLOWUP_HEADING);
}

/** Captures the indent width + text of an unchecked list item, else null. */
const UNCHECKED_ITEM = /^(\s*)(?:[-*]|\d+\.)\s+\[ \]\s+(.*)$/;

/**
 * Pulls the participant's *pending* hand-written action items out of a
 * "## Action items" (or "## Follow-ups") section body: the top-level unchecked
 * task lines — unordered (`- [ ] …`, `* [ ] …`) or ordered (`1. [ ] …`) — with
 * the checkbox marker stripped. Completed (`- [x]`) items are skipped:
 * completed work is preserved verbatim by {@link refreshActionItems} and must
 * not be re-listed as open.
 *
 * "Top-level" is the *least-indented* unchecked task in the section, not
 * strictly column 0 — so a list the user (or their editor) indented uniformly
 * is still captured, matching `refreshActionItems`, which drops indented
 * unchecked tasks too; anything more indented than that is a sub-bullet detail
 * and left out.
 *
 * Fed into the enrichment prompt so the model folds them into a single unified
 * list (honoring/improving each one) instead of silently replacing them.
 * Pure/testable.
 */
export function extractManualActionItems(sectionBody: string): string[] {
	const found: { indent: number; text: string }[] = [];
	for (const raw of sectionBody.split("\n")) {
		const m = raw.match(UNCHECKED_ITEM);
		if (!m) continue;
		const text = (m[2] ?? "").trim();
		if (text) found.push({ indent: (m[1] ?? "").length, text });
	}
	if (found.length === 0) return [];
	const topLevel = Math.min(...found.map((f) => f.indent));
	return found.filter((f) => f.indent === topLevel).map((f) => f.text);
}

/**
 * Strips Tasks-plugin date stamps and trailing block refs from a hand-written
 * task's display text before feeding it to the enrichment prompt, so the model
 * doesn't echo or garble `➕`/`✅` metadata.
 */
export function stripTaskMeta(text: string): string {
	return text
		.replace(/\s*➕\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
		.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
		.replace(/\s*\^[A-Za-z0-9-]+\s*$/, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Matches an *unchecked* task line, e.g. `- [ ] foo` or `1. [ ] foo`. */
const UNCHECKED_TASK = /^\s*(?:[-*]|\d+\.)\s+\[ \]\s+/;

/** Normalizes a task line for duplicate detection (drops checkbox, bold, dates, casing). */
function normalizeTask(line: string): string {
	return line
		.replace(TASK_LINE, "")
		.replace(/\*\*/g, "")
		.replace(/\s*➕\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
		.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*/g, " ")
		.replace(/\s*\^[A-Za-z0-9-]+\s*$/, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Refreshes an action/follow-up section on (re-)enrichment.
 *
 * Completed items (`- [x]`) and any non-task prose are kept verbatim, so
 * done-tracking and manual notes survive. The previous *unchecked* items are
 * dropped and replaced by the freshly generated set — otherwise each re-enrich
 * would pile up reworded near-duplicates of the same task (the exact-text
 * dedupe couldn't catch "Schedule a meeting with Luca" vs. "Schedule a
 * discussion with Luca"). Freshly generated items that duplicate a kept
 * (completed) task are skipped.
 *
 * Creation stamps (`➕ YYYY-MM-DD`) from the previous unchecked set are carried
 * onto a matching fresh item (by normalized text, dates stripped) so
 * re-enrichment doesn't reset age / horizon filtering when the model keeps
 * the same task wording. Truly reworded tasks get a fresh stamp from the
 * caller via {@link stampCreatedDate}.
 */
export function refreshActionItems(
	existingSection: string,
	newItems: string[]
): string {
	const lines = existingSection.replace(/\s+$/, "").split("\n");
	const prevUnchecked = lines.filter((l) => UNCHECKED_TASK.test(l));
	const kept = lines.filter((l) => !UNCHECKED_TASK.test(l));
	while (kept.length && (kept[0] ?? "").trim() === "") kept.shift();
	while (kept.length && (kept[kept.length - 1] ?? "").trim() === "") kept.pop();

	// normalizeTask(text) → prior ➕ stamp (YYYY-MM-DD), for carry-forward.
	const priorCreated = new Map<string, string>();
	for (const line of prevUnchecked) {
		const key = normalizeTask(line);
		const m = line.match(/➕\s*(\d{4}-\d{2}-\d{2})/);
		if (key && m?.[1] && !priorCreated.has(key)) priorCreated.set(key, m[1]);
	}

	const seen = new Set(
		kept.filter((l) => TASK_LINE.test(l)).map(normalizeTask)
	);
	const fresh: string[] = [];
	for (const item of newItems) {
		const key = normalizeTask(item);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		const prior = priorCreated.get(key);
		if (prior && !CREATED_DATE_RE.test(item)) {
			fresh.push(...stampCreatedDate([item], prior));
		} else {
			fresh.push(item);
		}
	}
	return [...kept, ...fresh].join("\n").trim();
}

/**
 * Appends a Tasks-plugin creation stamp (`➕ YYYY-MM-DD`) to each *unchecked*
 * task line that doesn't already have one. Completed tasks, prose, and blank
 * lines are left untouched. A trailing block reference (` ^id`) stays at the
 * end. Pure/testable; used when lifting freshly generated items into the note.
 */
export function stampCreatedDate(items: string[], dateStr: string): string[] {
	const mark = `➕ ${dateStr}`;
	return items.map((line) => {
		if (!UNCHECKED_TASK.test(line)) return line;
		if (CREATED_DATE_RE.test(line)) return line;
		const ref = line.match(/(\s+\^[A-Za-z0-9-]+)\s*$/);
		if (ref) {
			const head = line.slice(0, line.length - ref[0].length).trimEnd();
			return `${head} ${mark}${ref[0]}`;
		}
		return `${line.trimEnd()} ${mark}`;
	});
}
