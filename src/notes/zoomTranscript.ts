/**
 * Deterministic Zoom `.vtt` transcript detection + cleanup — no LLM call
 * needed, so it's instant and never hallucinates. Mirrors the cue-cleanup
 * rules of the zoom-transcripts skill (strip org/role speaker suffixes, merge
 * consecutive same-speaker cues, drop standalone filler cues), but outputs the
 * plugin's own "Speaker: text" per-line transcript convention (see
 * `diarize.ts`'s `mergeDiarized`), not markdown blocks — so an imported Zoom
 * transcript reads exactly like a locally-recorded one to the enrichment
 * prompt.
 */

/** Strips a trailing " @ Org" / " | Role" suffix Zoom sometimes appends to a display name. */
const SPEAKER_SUFFIX = /\s*(?:@|\|)\s*.+$/;

/** Standalone utterances that carry no content of their own, dropped unless they're all a speaker said. */
const FILLERS = new Set([
	"ja",
	"okay",
	"ok",
	"right",
	"mhm",
	"mm-hmm",
	"yeah",
	"yep",
	"sure",
	"cool",
	"got it",
	"sounds good",
	"thanks",
	"thank you",
]);

function cleanSpeaker(raw: string): string {
	return raw.replace(SPEAKER_SUFFIX, "").trim();
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function isFiller(text: string): boolean {
	const normalized = text
		.toLowerCase()
		.replace(/[.,;:!?…]+$/g, "")
		.trim();
	return FILLERS.has(normalized);
}

interface RawEntry {
	speaker: string;
	text: string;
	isUnknown: boolean;
}

/** Parses WebVTT cue blocks (`index` / `start --> end` / text…) into speaker/text entries. */
function parseCueBlocks(content: string): {
	entries: RawEntry[];
	cueCount: number;
} {
	const lines = content.replace(/\r/g, "").split("\n");
	const entries: RawEntry[] = [];
	let cueCount = 0;

	let i = 0;
	while (i < lines.length) {
		const line = (lines[i] ?? "").trim();
		const nextLine = (lines[i + 1] ?? "").trim();

		if (/^\d+$/.test(line) && /-->/.test(nextLine)) {
			cueCount += 1;
			i += 2;
			const textLines: string[] = [];
			while (i < lines.length && (lines[i] ?? "").trim() !== "") {
				textLines.push(lines[i] ?? "");
				i += 1;
			}

			const cueText = normalizeText(textLines.join(" "));
			const speakerMatch = cueText.match(/^([^:]+):\s*(.+)$/);
			if (speakerMatch) {
				const speaker = cleanSpeaker(speakerMatch[1] ?? "");
				const text = normalizeText(speakerMatch[2] ?? "");
				if (speaker && text) entries.push({ speaker, text, isUnknown: false });
			} else if (cueText) {
				entries.push({
					speaker: "Unknown Speaker",
					text: cueText,
					isUnknown: true,
				});
			}
		}

		i += 1;
	}

	return { entries, cueCount };
}

interface MergedEntry {
	speaker: string;
	text: string;
}

function mergeConsecutive(entries: RawEntry[]): MergedEntry[] {
	const merged: { speaker: string; parts: string[] }[] = [];
	for (const entry of entries) {
		const last = merged[merged.length - 1];
		if (last && last.speaker === entry.speaker) {
			last.parts.push(entry.text);
		} else {
			merged.push({ speaker: entry.speaker, parts: [entry.text] });
		}
	}

	return merged.map((group) => {
		const nonFiller = group.parts.filter((part) => !isFiller(part));
		const partsToUse = nonFiller.length > 0 ? nonFiller : [group.parts[0] ?? ""];
		return { speaker: group.speaker, text: normalizeText(partsToUse.join(" ")) };
	});
}

export interface ParsedZoomTranscript {
	participants: string[];
	/** "Speaker: text" per line — the plugin's own transcript convention. */
	transcript: string;
}

/**
 * True when content looks like a Zoom `.vtt` export: a `WEBVTT` header
 * followed by at least one numbered cue with a `-->` timestamp line. Renamed
 * or re-extensioned files still match, since this checks content, not the
 * filename.
 */
export function looksLikeZoomVtt(content: string): boolean {
	const trimmed = content.replace(/^\uFEFF/, "").trimStart();
	if (!/^WEBVTT/i.test(trimmed)) return false;
	const lines = trimmed.split("\n");
	for (let i = 0; i < lines.length - 1; i++) {
		if (/^\d+$/.test((lines[i] ?? "").trim()) && /-->/.test((lines[i + 1] ?? "").trim())) {
			return true;
		}
	}
	return false;
}

/**
 * Deterministically parses and cleans a Zoom `.vtt` transcript — no LLM call.
 * Returns `null` when too few cues parsed as clean "Speaker: text" turns to
 * trust the result (mirrors the zoom-transcripts skill's escape hatch for a
 * non-standard export); the caller should fall back to LLM cleanup instead.
 */
export function parseZoomTranscript(content: string): ParsedZoomTranscript | null {
	const { entries, cueCount } = parseCueBlocks(content);
	if (cueCount === 0 || entries.length === 0) return null;

	const unknownCount = entries.filter((e) => e.isUnknown).length;
	if (unknownCount / entries.length > 0.35) return null;

	const merged = mergeConsecutive(entries);
	const participants = [...new Set(merged.map((e) => e.speaker))].sort();
	const transcript = merged.map((e) => `${e.speaker}: ${e.text}`).join("\n");
	return { participants, transcript };
}
