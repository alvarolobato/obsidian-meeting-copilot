/**
 * A no-progress ("inactivity") watchdog (issue #96).
 *
 * The remote {@link ./OpenAICompatibleBackend} bounds every individual request
 * with a per-call timeout (see `ApiClient`), so a stalled gateway can no longer
 * hang a single request forever. This watchdog is the outer, last-resort net: it
 * fires `onTimeout` when NO progress has been reported for `timeoutMs`, catching
 * a hang that lives *outside* a single request (e.g. a promise deep in the
 * vendored orchestration that never settles) — which would otherwise wedge the
 * serial transcription queue until Obsidian restarts.
 *
 * Each {@link InactivityWatchdog.ping} restarts the window (so a run that keeps
 * making progress is never interrupted); {@link InactivityWatchdog.stop} disarms
 * it. The timer source is injectable so it's unit-testable with fake timers.
 */
export interface InactivityWatchdog {
	/** Reset the inactivity window; call on each unit of progress. */
	ping(): void;
	/** Disarm the watchdog; call in a `finally`. Idempotent. */
	stop(): void;
}

/** Minimal timer surface (a subset of `Window`), so tests can inject fakes. */
export interface WatchdogTimer {
	setTimeout: (handler: () => void, ms: number) => number;
	clearTimeout: (handle: number) => void;
}

export function startInactivityWatchdog(
	timeoutMs: number,
	onTimeout: () => void,
	timer: WatchdogTimer = globalThis as unknown as WatchdogTimer
): InactivityWatchdog {
	let handle: number | undefined;
	let stopped = false;
	const arm = (): void => {
		handle = timer.setTimeout(() => {
			// A late fire after stop() must be a no-op (the handle may already be
			// queued when stop() lands).
			if (!stopped) onTimeout();
		}, timeoutMs);
	};
	arm();
	return {
		ping(): void {
			if (stopped) return;
			if (handle !== undefined) timer.clearTimeout(handle);
			arm();
		},
		stop(): void {
			if (stopped) return;
			stopped = true;
			if (handle !== undefined) timer.clearTimeout(handle);
		},
	};
}
