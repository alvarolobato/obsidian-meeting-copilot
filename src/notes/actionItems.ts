/** Heading (## or ###) that holds action items in the enriched output. */
const ACTION_HEADING =
	/^#{2,3}\s+(next steps|action items|actions|follow[- ]?ups?|to[- ]?dos?)\s*$/i;

/** Matches a markdown task line, e.g. `- [ ] foo`, `* [x] bar`, or `1. [ ] baz`. */
const TASK_LINE = /^\s*(?:[-*]|\d+\.)\s+\[[ xX]\]\s+/;

export interface ExtractedActions {
	/** Action items rendered as `- [ ] …` task lines (top-level items only). */
	items: string[];
	/** The input markdown with the action-items section removed. */
	without: string;
}

/**
 * Pulls the action-items section out of enriched markdown, converting its
 * top-level bullets into obsidian-tasks checkboxes and returning the markdown
 * with that section stripped (so it isn't duplicated inside the AI callout).
 * Indented sub-bullets are treated as context and left out of the task list.
 */
export function extractActionItems(markdown: string): ExtractedActions {
	const lines = markdown.split("\n");
	const start = lines.findIndex((l) => ACTION_HEADING.test(l.trim()));
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

/** Captures the indent width + text of an unchecked list item, else null. */
const UNCHECKED_ITEM = /^(\s*)(?:[-*]|\d+\.)\s+\[ \]\s+(.*)$/;

/**
 * Pulls the participant's *pending* hand-written action items out of a
 * "## Action items" section body: the top-level unchecked task lines — unordered
 * (`- [ ] …`, `* [ ] …`) or ordered (`1. [ ] …`) — with the checkbox marker
 * stripped. Completed (`- [x]`) items are skipped: completed work is preserved
 * verbatim by {@link refreshActionItems} and must not be re-listed as open.
 *
 * "Top-level" is the *least-indented* unchecked task in the section, not
 * strictly column 0 — so a list the user (or their editor) indented uniformly
 * is still captured, matching `refreshActionItems`, which drops indented
 * unchecked tasks too; anything more indented than that is a sub-bullet detail
 * and left out.
 *
 * Fed into the enrichment prompt so the model folds them into a single unified
 * "Next steps" list (honoring/improving each one) instead of silently
 * replacing them. Pure/testable.
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

/** Matches an *unchecked* task line, e.g. `- [ ] foo` or `1. [ ] foo`. */
const UNCHECKED_TASK = /^\s*(?:[-*]|\d+\.)\s+\[ \]\s+/;

/** Normalizes a task line for duplicate detection (drops checkbox, bold, casing). */
function normalizeTask(line: string): string {
	return line
		.replace(TASK_LINE, "")
		.replace(/\*\*/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * Refreshes the "Action items" section on (re-)enrichment.
 *
 * Completed items (`- [x]`) and any non-task prose are kept verbatim, so
 * done-tracking and manual notes survive. The previous *unchecked* items are
 * dropped and replaced by the freshly generated set — otherwise each re-enrich
 * would pile up reworded near-duplicates of the same task (the exact-text
 * dedupe couldn't catch "Schedule a meeting with Luca" vs. "Schedule a
 * discussion with Luca"). Freshly generated items that duplicate a kept
 * (completed) task are skipped.
 */
export function refreshActionItems(
	existingSection: string,
	newItems: string[]
): string {
	const kept = existingSection
		.replace(/\s+$/, "")
		.split("\n")
		.filter((l) => !UNCHECKED_TASK.test(l));
	while (kept.length && (kept[0] ?? "").trim() === "") kept.shift();
	while (kept.length && (kept[kept.length - 1] ?? "").trim() === "") kept.pop();

	const seen = new Set(
		kept.filter((l) => TASK_LINE.test(l)).map(normalizeTask)
	);
	const fresh: string[] = [];
	for (const item of newItems) {
		const key = normalizeTask(item);
		if (key && !seen.has(key)) {
			seen.add(key);
			fresh.push(item);
		}
	}
	return [...kept, ...fresh].join("\n").trim();
}
