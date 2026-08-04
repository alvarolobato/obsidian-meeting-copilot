/**
 * Pure decision logic for the max-recording-length safety cap: force-stops a
 * recording that's run too long, regardless of calendar/detection state — a
 * guard against a forgotten/stuck recording (a real ~15h accidental recording
 * OOM-crashed transcription; see `transcribe/vadWindows.ts`'s duration guard
 * for the sibling fix on the transcription side). Kept Obsidian-free so the
 * threshold math is unit-testable without a vault or the recorder.
 */

export type MaxRecordingAction = "none" | "warn" | "stop";

export interface MaxRecordingInput {
	/** Wall-clock seconds since the recording started. */
	elapsedSeconds: number;
	/** `maxRecordingHours` setting; `0` disables the cap entirely. */
	maxHours: number;
	/** How many seconds before the cutoff to warn (`MAX_RECORDING_WARNING_SECONDS`). */
	warningSeconds: number;
	/** Whether the warning prompt for this recording is already showing. */
	warningAlreadyShown: boolean;
	/** True once the user picked "Keep recording" on the warning. */
	cancelled: boolean;
}

/**
 * Decides what (if anything) to do this tick. `cancelled` takes priority over
 * everything else: an explicit "keep recording" choice shouldn't be
 * re-litigated every second for the rest of the session. `warn` only fires
 * once (`warningAlreadyShown` guards it) — the caller re-derives `stop` from
 * `elapsedSeconds` on every later tick regardless, so the actual cutoff never
 * depends on the warning having fired.
 */
export function maxRecordingAction(input: MaxRecordingInput): MaxRecordingAction {
	if (input.maxHours <= 0 || input.cancelled) return "none";
	const maxSeconds = input.maxHours * 3600;
	if (input.elapsedSeconds >= maxSeconds) return "stop";
	if (
		input.elapsedSeconds >= maxSeconds - input.warningSeconds &&
		!input.warningAlreadyShown
	) {
		return "warn";
	}
	return "none";
}
