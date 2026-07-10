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
 * Merges freshly generated task lines into an existing "Action items" section
 * body. The entire existing body is preserved verbatim (tasks, prose, and
 * sub-bullets), so re-enriching never loses user edits or completed work; new
 * items are appended only when not already present as a task (matched by
 * normalized text).
 */
export function mergeActionItems(
	existingSection: string,
	newItems: string[]
): string {
	const existing = existingSection.replace(/\s+$/, "");
	const seen = new Set(
		existing
			.split("\n")
			.filter((l) => TASK_LINE.test(l))
			.map(normalizeTask)
	);
	const toAdd: string[] = [];
	for (const item of newItems) {
		const key = normalizeTask(item);
		if (key && !seen.has(key)) {
			seen.add(key);
			toAdd.push(item);
		}
	}
	if (existing.length === 0) return toAdd.join("\n");
	if (toAdd.length === 0) return existing;
	return `${existing}\n${toAdd.join("\n")}`;
}
