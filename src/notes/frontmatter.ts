/**
 * A minimal YAML-frontmatter reader for the *raw* note content the dashboard
 * already holds in memory.
 *
 * Obsidian's `metadataCache` is the normal source of a note's frontmatter, but
 * it is a cache: right after a write (this plugin ticking a task, enrichment
 * appending a section) `getFileCache` can return `null` until the re-index
 * lands. Callers that only *read* a note's identity therefore need a fallback
 * that can't go stale — otherwise a note briefly loses its
 * `one_on_one_with` / `recurring_event_id` and gets re-grouped as an ad-hoc
 * note for one render pass (see `scanOpenTaskNotes`).
 *
 * Only the shapes this plugin's own frontmatter uses are supported: top-level
 * `key: value` scalars and `key:` followed by an indented `- item` list.
 * Nested maps are ignored rather than half-parsed. Pure/testable.
 */

/** Strips symmetric quotes from a scalar and unescapes the doubled kind. */
function unquote(raw: string): string {
	const v = raw.trim();
	if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
		return v.slice(1, -1).replace(/\\"/g, '"');
	}
	if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
		return v.slice(1, -1).replace(/''/g, "'");
	}
	return v;
}

/**
 * Coerces a YAML scalar the way Obsidian's own frontmatter parse would for the
 * fields we care about: booleans and plain integers become primitives, `null`
 * and an empty value become `null`, everything else stays a string (dates
 * included — the rest of the plugin parses those itself).
 */
function scalar(raw: string): unknown {
	const v = raw.trim();
	if (v === "" || v === "null" || v === "~") return null;
	if (v === "true") return true;
	if (v === "false") return false;
	if (/^-?\d+$/.test(v)) return Number(v);
	return unquote(v);
}

/**
 * Parses the leading `---` frontmatter block of a note. Returns `undefined`
 * when the content has no frontmatter at all, so callers can tell "no block"
 * from "an empty block".
 */
export function parseFrontmatter(
	content: string
): Record<string, unknown> | undefined {
	// CRLF-tolerant: a note authored on Windows or round-tripped through an
	// external sync otherwise leaves a `\r` on every line, which the entry
	// regex below can't match — the whole block would parse to `{}` and the
	// note would lose its identity exactly as if there were no frontmatter.
	const lines = content.split(/\r?\n/);
	// Both fences must sit at column 0 (YAML's rule, and Obsidian's): an
	// indented `---` inside a block scalar is content, not a terminator, so
	// trimming here would end the block early and drop every key after it.
	// Trailing whitespace on the fence line itself is tolerated. A leading BOM
	// is stripped because vault files sometimes carry one.
	const isFence = (line: string): boolean => /^(?:---|\.\.\.)[ \t]*$/.test(line);
	if (!isFence((lines[0] ?? "").replace(/^\uFEFF/, ""))) return undefined;
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (isFence(lines[i] ?? "")) {
			end = i;
			break;
		}
	}
	if (end === -1) return undefined;

	const fm: Record<string, unknown> = {};
	let listKey: string | null = null;
	let list: string[] = [];
	// A `key:` with no `- item` under it stays the `null` written when it was
	// opened — matching Obsidian, which reports an empty value as null rather
	// than as an empty list.
	const flushList = (): void => {
		if (listKey !== null && list.length > 0) fm[listKey] = list;
		listKey = null;
		list = [];
	};

	for (let i = 1; i < end; i++) {
		const line = lines[i] ?? "";
		if (!line.trim() || line.trim().startsWith("#")) continue;
		// A block sequence may be flush with its key (zero indent) — valid
		// YAML that Obsidian parses, so requiring indentation here would drop
		// the items and leave the key looking empty.
		const item = line.match(/^\s*-\s+(.*)$/);
		if (item && listKey !== null) {
			list.push(String(unquote(item[1] ?? "")));
			continue;
		}
		const entry = line.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
		if (!entry) continue;
		flushList();
		const key = entry[1] ?? "";
		const rest = entry[2];
		if (rest === undefined || rest.trim() === "") {
			// `key:` on its own opens a list (or a nested map we don't parse);
			// an empty scalar is written out only if no `- item` follows.
			listKey = key;
			fm[key] = null;
			continue;
		}
		fm[key] = scalar(rest);
	}
	flushList();
	return fm;
}
