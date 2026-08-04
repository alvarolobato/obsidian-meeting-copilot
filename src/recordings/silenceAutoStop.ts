/**
 * Pure decision logic for silence-based auto-stop: warn, then force-stop, a
 * recording that's had no detected speech on either stream for too long — the
 * common real-world shape of a forgotten recording (an empty room, not
 * necessarily an open meeting app), and an earlier, more targeted safety net
 * than the absolute `maxRecordingHours` cap in `maxRecordingLength.ts`. Kept
 * Obsidian-free so the threshold math is unit-testable without a vault or the
 * recorder.
 */

export type SilenceAutoStopAction = "none" | "warn" | "stop";

export interface SilenceAutoStopInput {
	/**
	 * Seconds since either stream last had audio above the recorder's RMS
	 * speech threshold (from the Swift helper's live status heartbeat, see
	 * `RecorderStatus.silentSeconds`).
	 */
	silentSeconds: number;
	/** `silenceAutoStopMinutes` setting; `0` disables the cap entirely. */
	thresholdMinutes: number;
	/** How many seconds before the cutoff to warn (shares `AUTO_STOP_WARNING_SECONDS`). */
	warningSeconds: number;
	/** Whether the warning prompt for this recording is already showing. */
	warningAlreadyShown: boolean;
	/** True once the user picked "Keep recording" on the warning. */
	cancelled: boolean;
}

/**
 * Same shape as `maxRecordingAction`: `cancelled` takes priority, `warn`
 * fires once, and `stop` is re-derived from `silentSeconds` every tick
 * regardless of whether the warning ever fired (e.g. a status heartbeat was
 * briefly missed) — kept as a separate function rather than sharing one with
 * `maxRecordingAction` since the two track genuinely different signals
 * (wall-clock elapsed vs. audio-silence elapsed) from different sources.
 */
export function silenceAutoStopAction(
	input: SilenceAutoStopInput
): SilenceAutoStopAction {
	if (input.thresholdMinutes <= 0 || input.cancelled) return "none";
	const thresholdSeconds = input.thresholdMinutes * 60;
	if (input.silentSeconds >= thresholdSeconds) return "stop";
	if (
		input.silentSeconds >= thresholdSeconds - input.warningSeconds &&
		!input.warningAlreadyShown
	) {
		return "warn";
	}
	return "none";
}
