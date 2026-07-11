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
export function notifyOs(
	title: string,
	body: string,
	onClick?: () => void
): boolean {
	try {
		const N = window.Notification;
		if (!N || N.permission !== "granted") return false;
		const notification = new N(title, { body });
		if (onClick) {
			notification.onclick = (): void => {
				try {
					window.focus();
				} catch {
					// Best-effort focus; clicking usually foregrounds the app on macOS.
				}
				onClick();
			};
		}
		return true;
	} catch {
		return false;
	}
}
