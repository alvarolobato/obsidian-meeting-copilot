/**
 * Native OS notifications (Tier 0). Obsidian's `Notice` is in-app only, so it's
 * invisible when Obsidian is minimized. Electron exposes the Web Notifications
 * API, which shows a real macOS notification even when the window is hidden.
 */

/** Requests notification permission once, so later notifications can show. */
export function requestNotificationPermission(): void {
	try {
		const N = window.Notification;
		if (N && N.permission === "default") {
			void N.requestPermission();
		}
	} catch {
		// Notifications unavailable (e.g. mobile); silently ignore.
	}
}

/**
 * Shows a native OS notification. Returns true when one was actually shown, so
 * callers can fall back to an in-app Notice otherwise. `onClick` fires when the
 * user clicks the notification (we also try to bring Obsidian to the front).
 */
/** The last notification we showed, so we can supersede it instead of stacking. */
let lastNotification: Notification | null = null;

export function notifyOs(
	title: string,
	body: string,
	onClick?: () => void
): boolean {
	try {
		const N = window.Notification;
		if (!N || N.permission !== "granted") return false;
		// Supersede any prior prompt so stale ones don't accumulate.
		try {
			lastNotification?.close();
		} catch {
			// ignore
		}
		const notification = new N(title, { body });
		lastNotification = notification;
		notification.onclick = (): void => {
			try {
				window.focus();
			} catch {
				// Best-effort focus; clicking usually foregrounds the app on macOS.
			}
			try {
				notification.close();
			} catch {
				// ignore
			}
			if (lastNotification === notification) lastNotification = null;
			onClick?.();
		};
		return true;
	} catch {
		return false;
	}
}
