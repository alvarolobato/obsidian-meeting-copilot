/**
 * Lightweight, toggleable logging for the notification pipeline. Flip
 * {@link NOTIF_DEBUG} off to silence it. Every line is prefixed so it's easy to
 * filter the Obsidian DevTools console (Cmd+Opt+I) with `mc:notif`.
 *
 * This is a diagnosis aid for the "notifications don't show" reports; it traces
 * which channel a prompt takes (in-app vs native), whether the native path is
 * even available, and every native/web notification event.
 */
export const NOTIF_DEBUG = true;

export function notifLog(event: string, data?: Record<string, unknown>): void {
	if (!NOTIF_DEBUG) return;
	if (data) {
		console.debug(`[mc:notif] ${event}`, data);
	} else {
		console.debug(`[mc:notif] ${event}`);
	}
}
