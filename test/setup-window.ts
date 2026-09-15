// Plugin code calls `window.setTimeout`, `window.fetch`, etc. (the Obsidian
// popout-window-safe form), but vitest runs in Node, which has no `window`.
// Alias it to the global scope so those calls resolve to Node's globals, and
// so `vi.useFakeTimers()` / `vi.stubGlobal()` still intercept them.
if (typeof globalThis.window === "undefined") {
	Object.defineProperty(globalThis, "window", {
		value: globalThis,
		configurable: true,
		writable: true,
	});
}
