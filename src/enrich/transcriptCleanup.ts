import { TRANSCRIPT_TRUNCATION_MARKER } from "./prompt";

/**
 * Prompt for cleaning up an imported transcript export whose format isn't
 * recognized as Zoom's `.vtt` (see `notes/zoomTranscript.ts`, which handles
 * that deterministically, with no LLM call). Anything else — plain text, SRT,
 * a chat export, a differently-shaped VTT — has its formatting stripped and
 * consecutive same-speaker turns merged by the model, since a one-off parser
 * can't cover every export shape. This is a reformatting pass only: it must
 * never summarize, invent, or drop substantive content.
 *
 * A very long import is budget-truncated the same way enrichment's own
 * transcript is (see `truncateTranscriptForBudget`), which can leave
 * {@link TRANSCRIPT_TRUNCATION_MARKER} in the middle of what's sent here — the
 * prompt tells the model to leave that marker alone rather than try to
 * satisfy "every utterance must appear" across a gap it can't see into.
 */
export const TRANSCRIPT_CLEANUP_SYSTEM_PROMPT =
	"You are a meticulous transcript editor. You convert a raw, arbitrarily " +
	"formatted meeting-transcript export into a clean, speaker-labeled " +
	"transcript. You only reformat and lightly clean it up — you never invent, " +
	"summarize, paraphrase, omit, reorder, or translate content.";

/** Fills the transcript-cleanup user prompt with the raw file content. */
export function buildTranscriptCleanupPrompt(raw: string): string {
	return `Raw transcript export (format unknown — could be plain text, SRT, a chat log, a non-standard VTT, or something else):
"""
${raw}
"""

Convert this into a clean, speaker-labeled transcript, one line per speaker turn, in exactly this format (no other markup):
Speaker Name: utterance text

Rules:
- Merge consecutive lines/cues from the same speaker into one line.
- Strip timestamps, cue numbers, and any formatting markup (VTT/SRT numbering and timing, HTML tags, etc.) — keep only the speaker and their words.
- Preserve speaker names/labels exactly as given in the source; never invent a name for an unlabeled speaker — use "Unknown Speaker" for those instead.
- Preserve the original language; do not translate.
- Do not summarize, paraphrase, invent, omit, or reorder any content — every substantive utterance in the source must appear in the output, only reformatted, EXCEPT across a "${TRANSCRIPT_TRUNCATION_MARKER.trim()}" marker if one appears: that marks content deliberately cut before it reached you, so leave it exactly as-is at the same position and never try to reconstruct, summarize, or comment on what's missing there.
- Drop only a standalone filler utterance (e.g. a lone "okay", "mhm", "right") when it's the *entire* content of a turn and that speaker has other, substantive turns elsewhere — never drop a turn that carries real content, and never drop the only turn a speaker has.
- Output only the cleaned transcript — no preamble, no commentary, no markdown headings.`;
}
