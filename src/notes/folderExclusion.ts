/**
 * Pure logic for the "Excluded folders" setting: a free-text list of folder
 * paths/glob patterns the user never wants scanned by anything the plugin
 * does — archived notes, another plugin's metadata folder, this plugin's own
 * metadata folder once it has one, etc. Kept Obsidian-free so it's testable
 * without a vault; every scan site in the plugin filters through
 * {@link isPathExcluded} before reading/considering a file.
 */

/** Splits a free-text folder-pattern box (newlines and/or commas) into trimmed, non-empty patterns. */
export function parseFolderPatterns(raw: string): string[] {
	return raw
		.split(/[\n,]/)
		.map((p) => p.trim().replace(/^\/+|\/+$/g, ""))
		.filter((p) => p.length > 0);
}

// Unicode Private Use Area code points — never appear in a real path/pattern
// — stand in for the two "**" idioms and a bare "**" while compilePattern
// works, so the later lone-"*" step can't find and mangle a "*" that was
// itself only just inserted as regex syntax. Built via fromCharCode (rather
// than a literal character) so the exact code points are unambiguous in the
// source rather than relying on an invisible glyph.
const GLOBSTAR_SLASH = String.fromCharCode(0xe000);
const SLASH_GLOBSTAR = String.fromCharCode(0xe001);
const GLOBSTAR = String.fromCharCode(0xe002);

// Compiled patterns are stateless (no /g flag, so no lastIndex to race) and
// the pattern set is small and effectively fixed per `excludedFolders`
// setting value, so a plain unbounded cache is fine — this is what makes
// `isPathExcluded` cheap to call once per file on every whole-vault scan
// instead of recompiling every pattern's RegExp on every call.
const compiledPatternCache = new Map<string, RegExp>();

/**
 * Compiles one glob-like pattern into a RegExp anchored to the whole string:
 * `*` matches within a single path segment, `**` matches across segments,
 * including zero — a "**", then "/", then "archived" pattern matches a
 * root-level "archived" too, not just a nested one; an "archived" folder
 * followed by "/**" matches "archived" itself as well as anything under it.
 * Everything else is a literal.
 */
function compilePattern(pattern: string): RegExp {
	const cached = compiledPatternCache.get(pattern);
	if (cached) return cached;
	// `*` is deliberately excluded here — it's the one glob metacharacter this
	// mini-language documents and handles below. Everything else, including
	// `?` (a regex quantifier that would otherwise make the preceding
	// character optional, or throw if it's the very first character), is
	// escaped so an incidental regex-special character in a real folder name
	// is matched literally.
	let p = pattern.replace(/[.?+^${}()|[\]\\]/g, "\\$&");
	// Order matters: both "**" idioms before a bare "**", which must be
	// before a lone "*". Plain substring split/join (not regex) for the
	// placeholder swaps, since the placeholders are simple literal strings.
	p = p.split("**/").join(GLOBSTAR_SLASH);
	p = p.split("/**").join(SLASH_GLOBSTAR);
	p = p.split("**").join(GLOBSTAR);
	p = p.replace(/\*/g, "[^/]*");
	p = p.split(GLOBSTAR_SLASH).join("(?:.*/)?");
	p = p.split(SLASH_GLOBSTAR).join("(?:/.*)?");
	p = p.split(GLOBSTAR).join(".*");
	const re = new RegExp(`^${p}$`);
	compiledPatternCache.set(pattern, re);
	return re;
}

/**
 * True when `path` (a note's vault path) is inside — or exactly matches —
 * any of `patterns`. A pattern with no wildcard excludes that folder and
 * everything under it (matching every ancestor prefix of `path`, not just
 * the full path itself), so a plain "Archive" works without requiring the
 * two-star suffix boilerplate for the common case.
 */
export function isPathExcluded(path: string, patterns: string[]): boolean {
	if (patterns.length === 0) return false;
	const compiled = patterns.map(compilePattern);
	const normalized = path.replace(/^\/+/, "");
	const segments = normalized.split("/");
	for (let i = 1; i <= segments.length; i++) {
		const prefix = segments.slice(0, i).join("/");
		if (compiled.some((re) => re.test(prefix))) return true;
	}
	return false;
}
