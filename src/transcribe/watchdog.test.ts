import { describe, it, expect, vi } from "vitest";
import { startInactivityWatchdog } from "./watchdog";

describe("startInactivityWatchdog", () => {
	it("fires onTimeout after the window elapses with no ping", () => {
		vi.useFakeTimers();
		try {
			const onTimeout = vi.fn();
			startInactivityWatchdog(1000, onTimeout);
			vi.advanceTimersByTime(999);
			expect(onTimeout).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(onTimeout).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("resets the window on each ping so ongoing progress is never interrupted", () => {
		vi.useFakeTimers();
		try {
			const onTimeout = vi.fn();
			const wd = startInactivityWatchdog(1000, onTimeout);
			// A ping every 800ms keeps resetting the 1000ms window.
			for (let i = 0; i < 5; i++) {
				vi.advanceTimersByTime(800);
				wd.ping();
			}
			expect(onTimeout).not.toHaveBeenCalled();
			// Now go quiet: it fires once the full window passes.
			vi.advanceTimersByTime(1000);
			expect(onTimeout).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not fire after stop()", () => {
		vi.useFakeTimers();
		try {
			const onTimeout = vi.fn();
			const wd = startInactivityWatchdog(1000, onTimeout);
			vi.advanceTimersByTime(500);
			wd.stop();
			vi.advanceTimersByTime(5000);
			expect(onTimeout).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("ping after stop is a no-op (stays disarmed)", () => {
		vi.useFakeTimers();
		try {
			const onTimeout = vi.fn();
			const wd = startInactivityWatchdog(1000, onTimeout);
			wd.stop();
			wd.ping();
			vi.advanceTimersByTime(5000);
			expect(onTimeout).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
