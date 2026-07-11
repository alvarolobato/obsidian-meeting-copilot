import { normalizePath } from "obsidian";

// Characters Obsidian/most filesystems reject in file names, plus wikilink-hostile ones.
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

/** Makes a string safe to use as a single file or folder name (never a path). */
export function sanitizeName(name: string): string {
	return name.replace(ILLEGAL, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

/** True for a folder segment that is empty, or made up only of dots ("", ".", "..", "..."), once trimmed. */
function isDotsOnly(segment: string): boolean {
	return /^\.*$/.test(segment.trim());
}

/**
 * Splits a path on "/", sanitizing each segment and dropping any that are
 * empty or only dots, so a value carrying "/", ".", or ".." can never inject
 * an extra folder or walk outside the intended root. Returns "" when nothing
 * is left.
 */
function joinSegments(input: string): string {
	const segments = input
		.trim()
		.replace(/\/+$/, "")
		.split("/")
		.filter((s) => !isDotsOnly(s))
		.map((s) => sanitizeName(s));
	const joined = segments.join("/");
	return joined.length > 0 ? normalizePath(joined) : "";
}

/**
 * Normalizes a user- or template-rendered folder path (see `joinSegments`
 * above), falling back to "Meetings" when nothing is left.
 */
export function normalizeFolderPath(input: string): string {
	return joinSegments(input) || "Meetings";
}

/**
 * The literal, token-free prefix of a folder template (e.g. "Meetings" from
 * "Meetings/{{year}}"), for callers that need a single stable folder to scope
 * a scan to rather than resolving a specific event's folder. Returns "" when
 * the template starts with a token (e.g. "{{series}}/notes") — the caller
 * decides its own fallback rather than this silently sweeping "Meetings".
 */
export function templateStaticRoot(template: string): string {
	const idx = template.indexOf("{{");
	return joinSegments(idx === -1 ? template : template.slice(0, idx));
}
