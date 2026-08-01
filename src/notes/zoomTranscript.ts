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

/**
 * True when `label` plausibly reads as a speaker's name rather than the tail
 * end of a sentence that happens to contain a colon (e.g. "so the plan is:
 * we ship Friday", or "Let's meet at 10:30" splitting on the wrong colon).
 * Real speaker names are short, don't contain digits or sentence punctuation,
 * and start with a capital letter.
 */
function looksLikeSpeakerLabel(label: string): boolean {
	if (!label || label.length > 60) return false;
	if (/[.,!?]/.test(label)) return false;
	if (/\d/.test(label)) return false;
	if (label.split(/\s+/).length > 6) return false;
	return /^[A-Z]/.test(label);
}

const SPEAKER_TEXT_RE = /^([^:\n]{1,60}):\s*(.+)$/;

interface RawEntry {
	speaker: string;
	text: string;
	isUnknown: boolean;
}

/**
 * Parses WebVTT cue blocks (an optional numeric identifier, a `start --> end`
 * timing line, then text lines) into speaker/text entries. The identifier is
 * optional per the WebVTT spec — Zoom always writes one, but other exporters
 * don't — so cues are found by their timing line alone, never by requiring a
 * preceding digit line (a `.vtt` with unnumbered cues would otherwise have
 * every one of them silently skipped, along with the fallback-to-LLM safety
 * net, since only entries that *did* parse count toward that ratio).
 */
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

		if (/-->/.test(line)) {
			cueCount += 1;
			i += 1;
			const textLines: string[] = [];
			// Stop at a blank line, the next timing line, or a bare identifier
			// line immediately followed by one — some exports omit the blank
			// separator between cues, and without this a missing one would
			// swallow the next cue's identifier/timing (and its text) into
			// this one.
			while (
				i < lines.length &&
				(lines[i] ?? "").trim() !== "" &&
				!/-->/.test((lines[i] ?? "").trim()) &&
				!(
					/^\d+$/.test((lines[i] ?? "").trim()) &&
					/-->/.test((lines[i + 1] ?? "").trim())
				)
			) {
				textLines.push(lines[i] ?? "");
				i += 1;
			}

			const cueText = normalizeText(textLines.join(" "));
			const speakerMatch = cueText.match(SPEAKER_TEXT_RE);
			let handled = false;
			if (speakerMatch) {
				const speaker = cleanSpeaker(speakerMatch[1] ?? "");
				const text = normalizeText(speakerMatch[2] ?? "");
				// A speaker that fails the name heuristic, or one that cleaned
				// away to nothing (e.g. a cue that's only "@alice:" with no
				// other name), falls through to Unknown Speaker below instead
				// of silently vanishing.
				if (speaker && text && looksLikeSpeakerLabel(speaker)) {
					entries.push({ speaker, text, isUnknown: false });
					handled = true;
				}
			}
			if (!handled && cueText) {
				entries.push({
					speaker: "Unknown Speaker",
					text: cueText,
					isUnknown: true,
				});
			}
			continue;
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
 * followed by at least one cue's `-->` timestamp line. Renamed or
 * re-extensioned files still match, since this checks content, not the
 * filename; a missing cue identifier (optional per the WebVTT spec) doesn't
 * disqualify it either.
 */
export function looksLikeZoomVtt(content: string): boolean {
	const trimmed = content.replace(/^\uFEFF/, "").trimStart();
	if (!/^WEBVTT/i.test(trimmed)) return false;
	return trimmed.split("\n").some((line) => /-->/.test(line.trim()));
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
