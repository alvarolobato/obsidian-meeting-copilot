/** Heading (## or ###) that holds action items in the enriched output. */
const ACTION_HEADING =
	/^#{2,3}\s+(next steps|action items|actions|follow[- ]?ups?|to[- ]?dos?)\s*$/i;

/** Matches a markdown task line, e.g. `- [ ] foo` or `* [x] bar`. */
const TASK_LINE = /^\s*[-*]\s+\[[ xX]\]\s+/;

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

/** Matches an *unchecked* task line, e.g. `- [ ] foo`. */
const UNCHECKED_TASK = /^\s*[-*]\s+\[ \]\s+/;

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
