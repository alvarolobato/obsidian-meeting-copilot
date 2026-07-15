/**
 * Native OS notifications (Tier 0). Obsidian's `Notice` is in-app only, so it's
 * invisible when Obsidian is minimized or on another Space.
 *
 * We prefer Electron's **main-process** `Notification` (reached from the
 * renderer via `electron.remote`), because it's the only path that can render
 * macOS **action buttons** — the first is the default (inline in the *Alerts*
 * notification style), the rest under the notification's dropdown ("Options").
 * When `remote` isn't exposed (older/newer Obsidian) or a notification can't be
 * shown that way, we fall back to the renderer's **web Notifications API**,
 * which shows a plain banner (title + body, no buttons) whose click still opens
 * the in-app prompt.
 *
 * Both paths report back through {@link NotifyOsOptions.onShown} /
 * {@link NotifyOsOptions.onFailed} so a caller can skip a redundant in-app
 * notice **only when it's sure** a system notification is actually on screen
 * (the native `show` event / web `onshow`), never on a fire-and-forget guess.
 */

/** One action button on a native notification. The first is the default; extras go in the macOS dropdown. */
export interface OsNotificationAction {
	text: string;
	run: () => void;
}

export interface NotifyOsOptions {
	title: string;
	/** Native notification body — kept clean (no "click for options" hint). */
	body: string;
	/**
	 * Appended to the body **only** on the web-API fallback, which can't render
	 * action buttons — so it nudges the user to open Obsidian to choose. The
	 * native (button-capable) path ignores it.
	 */
	webHint?: string;
	/** Fires when the notification body is clicked (we also bring Obsidian forward). */
	onClick?: () => void;
	/** Native action buttons (first = default; the rest live under the dropdown). */
	actions?: OsNotificationAction[];
	/**
	 * Fired **at most once** when we are sure a system notification is on screen
	 * (native `show`, or web `onshow`). Lets callers dedupe an in-app fallback.
	 */
	onShown?: () => void;
	/** Fired **at most once** when no system notification could be shown at all. */
	onFailed?: () => void;
}

/** Handle to the shown notification, so a caller can close it programmatically. */
export interface OsNotificationHandle {
	close(): void;
}

interface RemoteNotificationInstance {
	show(): void;
	close(): void;
	on(
		event: "click" | "action" | "close" | "failed" | "show",
		listener: (...args: unknown[]) => void
	): void;
}

interface RemoteNotificationCtor {
	new (opts: {
		title: string;
		body: string;
		actions?: { type: "button"; text: string }[];
		silent?: boolean;
	}): RemoteNotificationInstance;
	isSupported?: () => boolean;
}

interface ElectronRemoteLike {
	Notification?: RemoteNotificationCtor;
}

interface ElectronRendererLike {
	remote?: ElectronRemoteLike;
}

/** Requests notification permission once, so later (web-fallback) notifications can show. */
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

/** The last notification we showed (native or web), so a newer one supersedes it instead of stacking. */
let lastNative: RemoteNotificationInstance | null = null;
let lastWeb: Notification | null = null;

function focusObsidian(): void {
	try {
		window.focus();
	} catch {
		// Best-effort; clicking usually foregrounds the app on macOS anyway.
	}
}

/**
 * Resolves the main-process `Notification` constructor via `electron.remote`,
 * or null when it isn't reachable / supported. Kept defensive: any missing seam
 * (no `require`, no `remote`, unsupported platform) just yields the web path.
 */
function getRemoteNotificationCtor(): RemoteNotificationCtor | null {
	try {
		const req = (window as unknown as { require?: (id: string) => unknown })
			.require;
		if (typeof req !== "function") return null;
		const electron = req("electron") as ElectronRendererLike | undefined;
		const Ctor = electron?.remote?.Notification;
		if (!Ctor) return null;
		if (typeof Ctor.isSupported === "function" && !Ctor.isSupported()) {
			return null;
		}
		return Ctor;
	} catch {
		return null;
	}
}

interface Settler {
	shown: () => void;
	failed: () => void;
	isSettled: () => boolean;
}

/** Ensures `onShown`/`onFailed` each resolve the notification's fate exactly once. */
function makeSettler(opts: NotifyOsOptions): Settler {
	let settled = false;
	return {
		shown: () => {
			if (settled) return;
			settled = true;
			opts.onShown?.();
		},
		failed: () => {
			if (settled) return;
			settled = true;
			opts.onFailed?.();
		},
		isSettled: () => settled,
	};
}

/** Shows a plain web-API banner (no action buttons); its click opens the in-app prompt. */
function createWeb(opts: NotifyOsOptions, settle: Settler): Notification | null {
	try {
		const N = window.Notification;
		if (!N || N.permission !== "granted") {
			settle.failed();
			return null;
		}
		try {
			lastWeb?.close();
		} catch {
			// ignore
		}
		const body = opts.webHint ? `${opts.body} · ${opts.webHint}` : opts.body;
		const notification = new N(opts.title, { body });
		lastWeb = notification;
		// `onshow` is the "sure it's on screen" signal for the web path.
		notification.onshow = (): void => settle.shown();
		notification.onerror = (): void => settle.failed();
		notification.onclick = (): void => {
			focusObsidian();
			try {
				notification.close();
			} catch {
				// ignore
			}
			if (lastWeb === notification) lastWeb = null;
			opts.onClick?.();
		};
		return notification;
	} catch {
		settle.failed();
		return null;
	}
}

/**
 * Attempts a native notification with action buttons. Returns the instance, or
 * null to signal the caller should fall back to the web path. On an async
 * `failed` (unsigned app / OS refusal) it falls back to the web path itself via
 * `onFallback`, so the settler is still resolved.
 */
function createNative(
	opts: NotifyOsOptions,
	settle: Settler,
	onFallback: () => void
): RemoteNotificationInstance | null {
	const Ctor = getRemoteNotificationCtor();
	if (!Ctor) return null;
	try {
		try {
			lastNative?.close();
		} catch {
			// ignore
		}
		const actions = opts.actions ?? [];
		const notification = new Ctor({
			title: opts.title,
			body: opts.body,
			actions: actions.map((a) => ({ type: "button", text: a.text })),
		});
		lastNative = notification;
		// On the modern UNNotification API (Electron 42+) `show`/`failed` fire
		// asynchronously, so we can't judge success synchronously — listen.
		notification.on("show", () => settle.shown());
		notification.on("failed", () => {
			if (lastNative === notification) lastNative = null;
			// A `show` already won the race (a late/spurious `failed`): don't stack
			// a second, web banner on top of the native one that's on screen.
			if (settle.isSettled()) return;
			// Native couldn't render (e.g. unsigned build): degrade to a web banner.
			onFallback();
		});
		notification.on("click", () => {
			focusObsidian();
			if (lastNative === notification) lastNative = null;
			opts.onClick?.();
		});
		notification.on("action", (...args: unknown[]) => {
			focusObsidian();
			// Electron passes (event, index); the index maps into `actions`.
			const index = typeof args[1] === "number" ? args[1] : 0;
			if (lastNative === notification) lastNative = null;
			actions[index]?.run();
		});
		notification.on("close", () => {
			if (lastNative === notification) lastNative = null;
		});
		notification.show();
		return notification;
	} catch {
		return null;
	}
}

/**
 * Shows a native OS notification, coordinating the native / web fallback and
 * reporting its fate through `onShown` / `onFailed`. `onClick` fires when the
 * user clicks the notification body (we also bring Obsidian to the front).
 *
 * When `actions` are supplied we try Electron's main-process notification so
 * they render as real macOS buttons (default first, rest under the dropdown);
 * if that path is unavailable / fails we degrade to a plain web banner.
 */
export function notifyOs(opts: NotifyOsOptions): OsNotificationHandle {
	const settle = makeSettler(opts);
	let nativeInst: RemoteNotificationInstance | null = null;
	let webInst: Notification | null = null;

	const tryWeb = (): void => {
		webInst = createWeb(opts, settle);
	};

	if (opts.actions && opts.actions.length > 0) {
		nativeInst = createNative(opts, settle, tryWeb);
	}
	if (!nativeInst) tryWeb();
	if (!nativeInst && !webInst) settle.failed();

	return {
		close(): void {
			try {
				nativeInst?.close();
			} catch {
				// ignore
			}
			try {
				webInst?.close();
			} catch {
				// ignore
			}
		},
	};
}
