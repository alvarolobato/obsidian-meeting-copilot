import { ENRICH_CALLOUT_TYPE, extractSection } from "./enrichedBlock";
import { upsertSection } from "./meetingNote";

/** Section that holds the participant's own notes. */
export const NOTES_HEADING = "## Notes";

const H1 = /^#\s/;
const H2 = /^##\s/;
/** Generated metadata bullets like "- **When:** …" — never treated as notes. */
const METADATA_BULLET = /^\s*[-*]\s+\*\*[^*]+:\*\*/;
const CALLOUT_START = new RegExp(`^>\\s*\\[!${ENRICH_CALLOUT_TYPE}\\][+-]?`);

export interface ManualNotes {
	/** All manual notes: the "## Notes" body plus any loose preamble notes. */
	notes: string;
	/** Content with loose preamble notes folded into "## Notes" (created if missing). */
	content: string;
}

function trimEdges(lines: string[]): string[] {
	const out = [...lines];
	while (out.length && (out[0] ?? "").trim() === "") out.shift();
	while (out.length && (out[out.length - 1] ?? "").trim() === "") out.pop();
	return out;
}

/** Joins note fragments, dropping blank and case-insensitively duplicate lines. */
function combineNotes(fragments: string[]): string {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const line of fragments.join("\n").split("\n")) {
		const key = line.trim().toLowerCase();
		if (!key) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(line.trim());
	}
	return out.join("\n").trim();
}

/**
 * Gathers the participant's manual notes wherever they wrote them and
 * consolidates them under "## Notes", so enrichment never silently ignores or
 * orphans notes typed above the "## Notes" heading (or when that heading was
 * deleted). Deterministic and pure so it can be unit-tested.
 *
 * "Loose" notes are body lines in the *preamble* — after the H1 title and
 * before the first "## " section — that aren't the generated metadata bullets
 * ("- **When:** …") or the AI-notes callout. Everything else in the note
 * (frontmatter, transcript, other sections) is left untouched. When there are
 * no loose notes the content is returned unchanged.
 */
export function normalizeManualNotes(content: string): ManualNotes {
	const lines = content.split("\n");

	// Skip YAML frontmatter so its "---" fences aren't mistaken for body.
	let bodyStart = 0;
	if ((lines[0] ?? "").trim() === "---") {
		const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
		if (close !== -1) bodyStart = close + 1;
	}

	// Preamble = after the first H1 (if present) up to the first H2 heading.
	let preStart = bodyStart;
	for (let i = bodyStart; i < lines.length; i++) {
		const l = lines[i] ?? "";
		if (H2.test(l)) break;
		if (H1.test(l)) {
			preStart = i + 1;
			break;
		}
	}
	let preEnd = lines.length;
	for (let i = preStart; i < lines.length; i++) {
		if (H2.test(lines[i] ?? "")) {
			preEnd = i;
			break;
		}
	}

	const loose: string[] = [];
	const keptPreamble: string[] = [];
	for (let i = preStart; i < preEnd; i++) {
		const line = lines[i] ?? "";
		if (CALLOUT_START.test(line)) {
			// Keep the AI-notes callout block verbatim (it's managed elsewhere).
			keptPreamble.push(line);
			i++;
			while (i < preEnd && /^>/.test(lines[i] ?? "")) {
				keptPreamble.push(lines[i] ?? "");
				i++;
			}
			i--;
			continue;
		}
		if (METADATA_BULLET.test(line) || line.trim() === "") {
			keptPreamble.push(line);
			continue;
		}
		loose.push(line);
	}

	const existingNotes = extractSection(content, NOTES_HEADING);
	const combined = combineNotes([existingNotes, loose.join("\n")]);

	// Nothing loose to relocate: leave the content untouched.
	if (loose.length === 0) return { notes: combined, content };

	const rebuiltLines = [
		...lines.slice(0, preStart),
		...trimEdges(keptPreamble),
		...lines.slice(preEnd),
	];
	const rebuilt = upsertSection(rebuiltLines.join("\n"), NOTES_HEADING, combined);
	return { notes: combined, content: rebuilt };
}
