/**
 * Lightweight, runtime-toggleable logging for the notification pipeline.
 * **Off by default**, and **local/custom builds only**: release builds compile
 * the flag check out (`__MC_RELEASE__`), so shipped code never reads
 * `localStorage` directly. Enable it live — no rebuild — from the Obsidian
 * DevTools console (Cmd+Opt+I):
 *
 *   localStorage.setItem("mc:notif-debug", "1")   // logging takes effect at once
 *   localStorage.removeItem("mc:notif-debug")      // to turn it back off
 *
 * The flag is read on every `notifLog` call, so tracing starts/stops
 * immediately within a running session. (Only the dev-only "test notification"
 * command in `main.ts` needs an Obsidian reload, since it's registered once at
 * load behind this same flag.)
 *
 * When on it traces which channel a prompt takes (in-app vs native), whether the
 * native path is even available, the raw window-focus signals, and every
 * native/web notification event. Every line is prefixed so it's easy to filter
 * the console with `mc:notif`, and nothing extra reaches end users while it's
 * off.
 */

import { formatLogData } from "./logLine";

// Set by esbuild's `define`: true only for release.yml builds. vitest defines it false.
declare const __MC_RELEASE__: boolean;

const DEBUG_KEY = "mc:notif-debug";

/**
 * True when notification tracing is enabled via the `mc:notif-debug`
 * localStorage flag. Always false in release builds: `!__MC_RELEASE__` becomes
 * `false` at build time, so {@link readDebugFlag} is unused and dropped from
 * the bundle.
 */
export function notifDebugEnabled(): boolean {
	return !__MC_RELEASE__ && readDebugFlag();
}

function readDebugFlag(): boolean {
	try {
		return window.localStorage.getItem(DEBUG_KEY) === "1";
	} catch {
		// No window/localStorage (e.g. tests, mobile) — treat as off.
		return false;
	}
}

export function notifLog(event: string, data?: Record<string, unknown>): void {
	if (!notifDebugEnabled()) return;
	// Single string so Obsidian console exports don't collapse payloads to
	// the literal word `Object` (#129). `console.warn` (not `debug`) so the
	// trace shows at the default DevTools log level.
	if (data) {
		console.warn(`[mc:notif] ${event} ${formatLogData(data)}`);
	} else {
		console.warn(`[mc:notif] ${event}`);
	}
}
