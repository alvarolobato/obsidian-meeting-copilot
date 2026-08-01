import { ENRICH_CALLOUT_TYPE, extractSection } from "./enrichedBlock";
import { upsertSection } from "./meetingNote";

/** Section that holds the participant's own notes. */
export const NOTES_HEADING = "## Notes";
/**
 * Legacy section. It was in the default note template until it was removed for
 * being redundant with "## Notes" and never actually read or written by the
 * app — but plenty of already-created notes still have it, some with real
 * notes typed under it. Folded into the enrichment input like "## Notes" so
 * that pre-existing content isn't silently ignored — but left in place in the
 * file itself (not relocated like loose preamble lines), since new notes won't
 * have this heading at all.
 */
export const SUMMARY_HEADING = "## Summary";

const H1 = /^#\s/;
const H2 = /^##\s/;
/** Generated metadata bullets like "- **When:** …" — never treated as notes. */
const METADATA_BULLET = /^\s*[-*]\s+\*\*[^*]+:\*\*/;
const CALLOUT_START = new RegExp(`^>\\s*\\[!${ENRICH_CALLOUT_TYPE}\\][+-]?`);

export interface ManualNotes {
	/** All manual notes: the "## Notes" and "## Summary" bodies plus any loose preamble notes. */
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
 * Gathers the participant's manual notes wherever they wrote them — the
 * "## Notes" body, the "## Summary" body, and any loose preamble notes — into
 * one string for enrichment, so none of it is silently ignored. Only the
 * loose preamble is actually relocated *in the file*, consolidated under
 * "## Notes" (created if missing) so it isn't orphaned above a heading that
 * may have been deleted; deterministic and pure so it can be unit-tested.
 *
 * "Loose" notes are body lines in the *preamble* — after the H1 title and
 * before the first "## " section — that aren't the generated metadata bullets
 * ("- **When:** …") or the AI-notes callout. "## Summary" content is read but
 * left where it is in the file (unlike loose preamble, it's already a proper
 * section, just one the app never reads on its own) — it's folded into the
 * enrichment string only, never moved. Everything else in the note
 * (frontmatter, transcript, other sections) is left untouched. When
 * there's nothing loose to relocate, the content is returned unchanged.
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
	const existingSummary = extractSection(content, SUMMARY_HEADING);
	// What gets physically relocated into "## Notes" on a rebuild — never
	// includes "## Summary", so its body is never duplicated into "## Notes"
	// in the file itself.
	const combinedForFile = combineNotes([existingNotes, loose.join("\n")]);
	// What's actually sent to the LLM — also folds in "## Summary" so those
	// bullets are never silently ignored, without touching the file for it.
	const combinedForLLM = combineNotes([
		existingNotes,
		existingSummary,
		loose.join("\n"),
	]);

	// Nothing loose to relocate: leave the content untouched.
	if (loose.length === 0) return { notes: combinedForLLM, content };

	const rebuiltLines = [
		...lines.slice(0, preStart),
		...trimEdges(keptPreamble),
		...lines.slice(preEnd),
	];
	const rebuilt = upsertSection(
		rebuiltLines.join("\n"),
		NOTES_HEADING,
		combinedForFile
	);
	return { notes: combinedForLLM, content: rebuilt };
}
