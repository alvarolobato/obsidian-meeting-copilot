/**
 * The AI Transcriber returns a marker-prefixed string for partial/failed runs
 * (see its `modal.transcription.partialResult` localization) instead of
 * throwing, so we detect those prefixes to avoid inserting error text as a
 * transcript. Covers the locales the upstream plugin ships.
 */
export const PARTIAL_TRANSCRIPT_MARKERS = [
	"Partial transcription result",
	"[部分的な文字起こし結果]",
	"（部分结果）",
	"[부분 전사 결과]",
];

export function isPartialTranscript(text: string): boolean {
	const t = text.trimStart();
	return PARTIAL_TRANSCRIPT_MARKERS.some((m) => t.startsWith(m));
}
