/**
 * Whole-segment hallucination detection for silent audio.
 *
 * Whisper reliably invents stock "filler" phrases when handed audio with no
 * speech: YouTube outros ("Thanks for watching!"), subtitle credits
 * ("Subtitles by the Amara.org community"), and bracketed non-speech tokens
 * ("[Music]"). On the mixed-file path the merged-text cleaner mostly catches
 * these, but on the DIARIZED path each stream's segments are placed on a shared
 * clock BEFORE any text cleaning runs, so a ghost "Thank you for watching." on
 * the mostly-silent mic stream gets a real timestamp and interleaves into the
 * transcript as a fake "Me:" line. Dropping these segments up front keeps the
 * merge clean.
 *
 * The match is WHOLE-segment for the exact-phrase set and every anchored
 * pattern: we discard a segment only when its ENTIRE text (after light
 * normalization) is a known artifact, never a real sentence that merely
 * contains one of these phrases. The one deliberate exception is a pair of CTA
 * *adjacency* substrings ("like [and] subscribe", "subscribe … bell") that
 * never occur in natural work-meeting speech; they're substring matches so they
 * survive the surrounding filler Whisper pads the outro with. This keeps false
 * positives near zero — a real "thank you" inside a longer sentence survives,
 * and confidence-based filtering (see diarize) catches the rest.
 *
 * No Obsidian imports so this stays fully unit testable.
 */

/**
 * Bracketed / angle-bracketed / parenthesized non-speech tokens that make up
 * the entire segment, e.g. "[Music]", "[ Applause ]", "(silence)",
 * "<inaudible>", "[BLANK_AUDIO]". Whisper emits these for non-speech audio.
 */
const NON_SPEECH_BRACKET = /^[[(<][^\])>]*[\])>]$/;

/** A segment made up only of musical-note glyphs (Whisper marks music this way). */
const MUSIC_NOTES = /^[\s♪♫🎵🎶]+$/u;

/**
 * Phrase families matched against the normalized text (see {@link normalize}).
 * Kept intentionally specific to silence artifacts so genuine short utterances
 * ("thanks", "bye", "okay") are NOT dropped here.
 */
const PHRASE_PATTERNS: RegExp[] = [
	// "Thank you." repeated within one segment, tolerating the interior
	// punctuation normalize() leaves in place ("thank you. thank you. thank you").
	/^(?:thank you[.!,\s]*){2,}$/,
	// YouTube outro family.
	/^thank(?:s| you)(?: (?:so |very )?much)? for watching$/,
	/^thanks for watching$/,
	/^thank you all for watching$/,
	// Subscribe / like / notification-bell CTA family. Kept tight so real
	// meeting speech ("please subscribe me to the incident channel", "I'd like
	// to subscribe to the premium tier") is NOT matched: whole-line outros, the
	// "like[,] [and] subscribe" adjacency (never said naturally), or subscribe
	// paired with a notification bell.
	/^(?:please )?(?:like(?:,? and| and)? )?subscribe(?: to (?:my|the) channel)?$/,
	/^(?:please )?(?:don'?t forget to )?(?:like and )?subscribe$/,
	/^(?:hit the )?like (?:button )?and subscribe$/,
	/\blike,?\s+(?:and\s+)?subscribe\b/,
	/\bsubscribe\b.*\b(?:bell icon|notification bell|(?:hit|ring) the bell|the bell button)\b/,
	// Sign-off outros.
	/^see you (?:next time|in the next (?:one|video))$/,
	// Subtitle / caption credits (the classic "Subtitles by the Amara.org
	// community" is caught by the "subtitles by …" / "…community" patterns).
	/^subtitles? (?:by|provided by|created by|are provided by)\b.*/,
	/^(?:transcription|transcribed|captions?) (?:by|provided by)\b.*/,
	/^(?:english )?(?:sub)?titles?\s+.*community$/,

	// --- Non-English silence artifacts ------------------------------------
	// Whisper invents localized YouTube outros / subtitle credits on silence
	// just as readily as English ones. Each is anchored to the WHOLE segment
	// (like the English patterns above) and length-bounded, so a long real
	// sentence that merely mentions one of these terms is NOT dropped — only a
	// segment that IS essentially the outro/credit. The confidence signals in
	// diarize.ts remain the language-agnostic backstop for anything padded
	// beyond these bounds.

	// The Amara.org subtitle credit appears verbatim across many languages
	// ("Napisy … Amara.org", "Subtítulos … Amara.org", "Untertitel der
	// Amara.org-Community", …). Bounded so it only matches a credit-length line.
	/^.{0,80}amara\.org.{0,20}$/,
	// Japanese: "ご視聴ありがとうございました" (thanks for watching) and the
	// "チャンネル登録…お願い(します)" subscribe CTA.
	/^.{0,16}ご視聴.{0,12}ありがとう.{0,12}$/,
	/^.{0,12}チャンネル登録.{0,12}お願い.{0,8}$/,
	// Korean: "시청해 주셔서 감사합니다" (thanks for watching).
	/^.{0,20}시청.{0,12}감사(?:합니다|드립니다)$/,
	// Chinese: "感谢观看" / "谢谢收看" (thanks for watching), "订阅…频道" (subscribe).
	/^.{0,10}(?:感谢|谢谢).{0,6}(?:观看|收看).{0,10}$/,
	/^.{0,8}订阅.{0,8}频道.{0,8}$/,
	// Russian: "Спасибо за просмотр" (thanks for watching).
	/^.{0,16}спасибо за просмотр.{0,16}$/,
	// Spanish / Portuguese / French / German thanks-for-watching sign-offs.
	/^(?:muchas )?gracias por (?:ver|verlo|acompañar)\b.{0,30}$/,
	/^obrigado por (?:assistir|ver)\b.{0,30}$/,
	/^merci d['’]?avoir regard[eé].{0,30}$/,
	/^(?:vielen )?dank(?:e)? (?:fürs|für das) zuschauen$/,
];

/**
 * Exact stock phrases (normalized) that are the entire segment. A lone
 * "thank you" over silence is a classic Whisper artifact; a real "thank you"
 * that's part of a sentence normalizes to a longer string and won't match.
 * A bare "you" is intentionally NOT here — it's too plausible as real speech;
 * the confidence signals catch it when it's a genuine silence ghost.
 */
const EXACT_PHRASES = new Set<string>([
	"thank you",
	"thank you very much",
	"thank you so much",
]);

/**
 * Lowercase, strip surrounding quotes/whitespace, collapse internal whitespace,
 * and drop trailing sentence punctuation so "Thank you!!" and "thank you"
 * compare equal. Interior punctuation is preserved so real sentences don't
 * accidentally collapse onto a stock phrase.
 */
function normalize(text: string): string {
	return text
		.trim()
		.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		// Trailing sentence punctuation, incl. CJK/full-width so a Japanese or
		// Chinese outro ending in "。" / "！" normalizes to the bare phrase.
		.replace(/[.!?…。！？，、]+$/gu, "")
		.trim();
}

/**
 * True when the segment is a known silence hallucination and should be dropped
 * before merging. Case-, punctuation-, and whitespace-insensitive. Matches the
 * whole segment except for the two CTA-adjacency substrings noted above.
 */
export function isHallucinationPhrase(text: string): boolean {
	const raw = text.trim();
	if (raw.length === 0) return true;
	if (NON_SPEECH_BRACKET.test(raw)) return true;
	if (MUSIC_NOTES.test(raw)) return true;

	const norm = normalize(text);
	if (norm.length === 0) return true;
	if (EXACT_PHRASES.has(norm)) return true;
	return PHRASE_PATTERNS.some((re) => re.test(norm));
}

/**
 * Strip whole-line hallucinations from a plain (non-diarized) transcript.
 *
 * The diarized path filters per segment before merging, but the mixed-file path
 * comes back as already-joined text with no segment seam. A fully-silent
 * recording there yields a transcript that is nothing but a stock phrase (the
 * original bug: a silent clip transcribed to "Please Like Subscribe and Enable
 * Notifications", which then became the note title). Dropping whole lines that
 * are a known artifact turns that into an empty transcript, so the caller shows
 * "nothing to transcribe" instead of writing a bogus note.
 *
 * Only ENTIRE lines are removed; a line with real content is left untouched.
 */
export function stripHallucinatedLines(text: string): string {
	return text
		.split("\n")
		.filter((line) => line.trim().length === 0 || !isHallucinationPhrase(line))
		.join("\n")
		.trim();
}
