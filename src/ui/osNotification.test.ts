import { describe, it, expect, afterEach, vi } from "vitest";
import { notifyOs } from "./osNotification";

type Handler = (...args: unknown[]) => void;

interface Harness {
	/** The last native notification created (null if the native path wasn't used). */
	native: () => FakeNative | null;
	/** The last web notification created (null if the web path wasn't used). */
	web: () => FakeWeb | null;
	nativeCount: () => number;
	webCount: () => number;
}

interface FakeNative {
	emit(event: string, ...args: unknown[]): void;
	shown: boolean;
	closed: boolean;
}

interface FakeWeb {
	onshow: (() => void) | null;
	onerror: (() => void) | null;
	onclick: (() => void) | null;
	closed: boolean;
}

/** Installs a fake `window` exercising the native (electron.remote) + web paths. */
function setupWindow(config: {
	remote: boolean;
	webPermission?: NotificationPermission;
}): Harness {
	const state: {
		native: FakeNative | null;
		web: FakeWeb | null;
		nativeCount: number;
		webCount: number;
	} = { native: null, web: null, nativeCount: 0, webCount: 0 };

	class NativeNotification {
		private handlers = new Map<string, Handler>();
		shown = false;
		closed = false;
		constructor(_opts: unknown) {
			state.native = this;
			state.nativeCount++;
		}
		on(event: string, cb: Handler): void {
			this.handlers.set(event, cb);
		}
		show(): void {
			this.shown = true;
		}
		close(): void {
			this.closed = true;
		}
		emit(event: string, ...args: unknown[]): void {
			this.handlers.get(event)?.(...args);
		}
	}

	class WebNotification {
		static permission: NotificationPermission =
			config.webPermission ?? "granted";
		onshow: (() => void) | null = null;
		onerror: (() => void) | null = null;
		onclick: (() => void) | null = null;
		closed = false;
		constructor(_title: string, _opts: unknown) {
			state.web = this;
			state.webCount++;
		}
		close(): void {
			this.closed = true;
		}
	}

	const fakeWindow = {
		Notification: WebNotification,
		focus: (): void => undefined,
		require: (id: string): unknown =>
			id === "electron" && config.remote
				? { remote: { Notification: NativeNotification } }
				: {},
	};
	(globalThis as unknown as { window: unknown }).window = fakeWindow;

	return {
		native: () => state.native,
		web: () => state.web,
		nativeCount: () => state.nativeCount,
		webCount: () => state.webCount,
	};
}

afterEach(() => {
	delete (globalThis as unknown as { window?: unknown }).window;
});

describe("notifyOs", () => {
	it("reports onShown when the native notification's show event fires", () => {
		const h = setupWindow({ remote: true });
		const onShown = vi.fn();
		const onFailed = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			actions: [{ text: "A", run: vi.fn() }],
			onShown,
			onFailed,
		});

		h.native()?.emit("show");

		expect(onShown).toHaveBeenCalledTimes(1);
		expect(onFailed).not.toHaveBeenCalled();
		expect(h.webCount()).toBe(0); // no redundant web banner
	});

	it("falls back to a web banner when the native notification fails", () => {
		const h = setupWindow({ remote: true, webPermission: "granted" });
		const onShown = vi.fn();
		const onFailed = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			actions: [{ text: "A", run: vi.fn() }],
			onShown,
			onFailed,
		});

		h.native()?.emit("failed");
		expect(h.webCount()).toBe(1);
		expect(onShown).not.toHaveBeenCalled();

		h.web()?.onshow?.(); // web confirms it's on screen
		expect(onShown).toHaveBeenCalledTimes(1);
		expect(onFailed).not.toHaveBeenCalled();
	});

	it("reports onFailed when native fails and web permission isn't granted", () => {
		const h = setupWindow({ remote: true, webPermission: "denied" });
		const onShown = vi.fn();
		const onFailed = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			actions: [{ text: "A", run: vi.fn() }],
			onShown,
			onFailed,
		});

		h.native()?.emit("failed");

		expect(onFailed).toHaveBeenCalledTimes(1);
		expect(onShown).not.toHaveBeenCalled();
		expect(h.webCount()).toBe(0);
	});

	it("does not stack a web banner when native fails AFTER it already showed", () => {
		const h = setupWindow({ remote: true });
		const onShown = vi.fn();
		const onFailed = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			actions: [{ text: "A", run: vi.fn() }],
			onShown,
			onFailed,
		});

		h.native()?.emit("show");
		h.native()?.emit("failed"); // late/spurious failure

		expect(onShown).toHaveBeenCalledTimes(1);
		expect(onFailed).not.toHaveBeenCalled();
		expect(h.webCount()).toBe(0);
	});

	it("routes native action clicks to the matching action handler", () => {
		const h = setupWindow({ remote: true });
		const runA = vi.fn();
		const runB = vi.fn();
		const onClick = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			onClick,
			actions: [
				{ text: "A", run: runA },
				{ text: "B", run: runB },
			],
		});

		h.native()?.emit("action", {}, 1);
		expect(runB).toHaveBeenCalledTimes(1);
		expect(runA).not.toHaveBeenCalled();

		h.native()?.emit("click");
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("uses the web path directly when electron.remote is unavailable", () => {
		const h = setupWindow({ remote: false, webPermission: "granted" });
		const onShown = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			actions: [{ text: "A", run: vi.fn() }],
			onShown,
		});

		expect(h.nativeCount()).toBe(0);
		expect(h.webCount()).toBe(1);
		h.web()?.onshow?.();
		expect(onShown).toHaveBeenCalledTimes(1);
	});

	it("reports onFailed when neither native nor web can show", () => {
		setupWindow({ remote: false, webPermission: "denied" });
		const onFailed = vi.fn();
		notifyOs({
			title: "t",
			body: "b",
			actions: [{ text: "A", run: vi.fn() }],
			onFailed,
		});

		expect(onFailed).toHaveBeenCalledTimes(1);
	});
});
