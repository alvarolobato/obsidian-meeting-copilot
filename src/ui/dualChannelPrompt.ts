/**
 * Coordinates a native OS notification with an in-app Obsidian `Notice` so the
 * user sees **exactly one** prompt.
 *
 * The caller decides the channel by window focus: when Obsidian is frontmost it
 * calls {@link DualChannelController.forceInApp} (the in-app notice is the
 * reliable, visible channel and a native banner would just duplicate it) and
 * skips the OS notification. When Obsidian isn't frontmost it posts the OS
 * notification and lets this machine coordinate the fallback:
 *
 *  - The in-app notice is a *fallback*: it's shown only after `fallbackDelayMs`
 *    unless the OS notification is confirmed on screen first — in which case
 *    it's skipped (or hidden, if it had already slipped in) to avoid a duplicate.
 *  - It's skipped **only when we're sure** the OS one was shown (the caller
 *    wires {@link DualChannelController.osShown} to the native `show` / web
 *    `onshow` event). If the OS notification fails, it's shown right away.
 *
 * (Note the native `show` event is a best-effort signal — macOS can route a
 * notification silently to Notification Center yet still fire it — which is why
 * the caller prefers the focus check over relying on `show` alone.)
 *
 * Timers are injected so the state machine is unit-testable with fakes.
 */

export interface DualChannelTimers {
	setTimeout: (handler: () => void, ms: number) => number;
	clearTimeout: (id: number) => void;
}

/** Minimal handle to an in-app notice — Obsidian's `Notice` satisfies this. */
export interface InAppHandle {
	hide(): void;
}

export interface DualChannelController {
	/** Call once the OS notification is confirmed on screen (native `show` / web `onshow`). */
	osShown(): void;
	/** Call when the OS notification could not be shown at all. */
	osFailed(): void;
	/**
	 * Show the in-app notice now, tracked so it's hidden on {@link dispose}. Used
	 * when the user clicks the OS notification body (it can't carry every action)
	 * so they always land on an actionable in-app prompt. Idempotent.
	 */
	forceInApp(): void;
	/** Tear everything down: cancel a pending fallback timer and hide the in-app notice if shown. */
	dispose(): void;
}

export interface DualChannelOptions {
	/** How long to wait for the OS notification to confirm before showing the in-app fallback. */
	fallbackDelayMs: number;
	timers: DualChannelTimers;
	/** Creates and shows the in-app notice, returning a handle to hide it. */
	showInApp: () => InAppHandle;
}

/**
 * Starts the coordination and returns a controller the caller feeds with the OS
 * notification's fate. See the module doc for the dedupe policy.
 */
export function startDualChannelPrompt(
	opts: DualChannelOptions
): DualChannelController {
	let inApp: InAppHandle | null = null;
	let timer: number | null = null;
	// Once the OS notification's fate is known we stop reacting to the timer.
	let settled = false;
	// The user explicitly asked for the in-app prompt (clicked the OS body), so a
	// later OS `show` confirmation must not silently hide it.
	let forced = false;
	let disposed = false;

	const cancelTimer = (): void => {
		if (timer !== null) {
			opts.timers.clearTimeout(timer);
			timer = null;
		}
	};

	const showInAppOnce = (): void => {
		if (inApp) return;
		inApp = opts.showInApp();
	};

	const hideInApp = (): void => {
		if (inApp) {
			inApp.hide();
			inApp = null;
		}
	};

	timer = opts.timers.setTimeout(() => {
		timer = null;
		// The OS notification hasn't confirmed within the grace window; surface
		// the in-app notice so the user isn't left without a prompt.
		if (!settled) showInAppOnce();
	}, opts.fallbackDelayMs);

	return {
		osShown(): void {
			if (settled) return;
			settled = true;
			cancelTimer();
			// If the fallback already slipped in (OS confirmed late), hide it so
			// only the system notification remains — no duplicate. But never hide
			// a notice the user explicitly asked for via `forceInApp`.
			if (!forced) hideInApp();
		},
		osFailed(): void {
			if (settled) return;
			settled = true;
			cancelTimer();
			showInAppOnce();
		},
		forceInApp(): void {
			// A late click on a superseded/handled prompt must not resurrect it.
			if (disposed) return;
			forced = true;
			showInAppOnce();
		},
		dispose(): void {
			disposed = true;
			settled = true;
			cancelTimer();
			hideInApp();
		},
	};
}
