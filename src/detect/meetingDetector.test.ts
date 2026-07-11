import { describe, expect, it, vi } from "vitest";
import { MeetingDetector } from "./meetingDetector";

function makeDetector(sequence: Set<string>[], endMissThreshold = 1) {
	let i = 0;
	const probe = vi.fn(() =>
		Promise.resolve(
			sequence[Math.min(i++, sequence.length - 1)] ?? new Set<string>()
		)
	);
	const onStart = vi.fn();
	const onEnd = vi.fn();
	const det = new MeetingDetector({ probe, onStart, onEnd, endMissThreshold });
	return { det, probe, onStart, onEnd };
}

describe("MeetingDetector", () => {
	it("fires onStart once when an app enters a meeting", async () => {
		const { det, onStart, onEnd } = makeDetector([
			new Set(),
			new Set(["Zoom"]),
			new Set(["Zoom"]),
		]);
		await det.poll();
		await det.poll();
		await det.poll();
		expect(onStart).toHaveBeenCalledTimes(1);
		expect(onStart).toHaveBeenCalledWith("Zoom");
		expect(onEnd).not.toHaveBeenCalled();
	});

	it("fires onEnd once when the meeting ends", async () => {
		const { det, onEnd } = makeDetector([
			new Set(["Zoom"]),
			new Set(),
		]);
		await det.poll();
		await det.poll();
		expect(onEnd).toHaveBeenCalledTimes(1);
		expect(onEnd).toHaveBeenCalledWith("Zoom");
		expect(det.isActive("Zoom")).toBe(false);
	});

	it("tracks multiple apps independently", async () => {
		const { det, onStart } = makeDetector([
			new Set(["Zoom"]),
			new Set(["Zoom", "Google Meet"]),
		]);
		await det.poll();
		await det.poll();
		expect(onStart).toHaveBeenCalledTimes(2);
		expect(det.isActive("Google Meet")).toBe(true);
	});

	it("re-fires onStart only after an end", async () => {
		const { det, onStart } = makeDetector([
			new Set(["Zoom"]),
			new Set(),
			new Set(["Zoom"]),
		]);
		await det.poll();
		await det.poll();
		await det.poll();
		expect(onStart).toHaveBeenCalledTimes(2);
	});

	it("requires consecutive misses before onEnd (hysteresis)", async () => {
		let i = 0;
		const seq = [
			new Set(["Zoom"]),
			new Set<string>(), // 1 miss — flicker, no end yet
			new Set(["Zoom"]), // recovered
			new Set<string>(), // miss 1
			new Set<string>(), // miss 2 — end fires
		];
		const onStart = vi.fn();
		const onEnd = vi.fn();
		const det = new MeetingDetector({
			probe: () => Promise.resolve(seq[Math.min(i++, seq.length - 1)] ?? new Set()),
			onStart,
			onEnd,
			endMissThreshold: 2,
		});
		for (let n = 0; n < 5; n++) await det.poll();
		expect(onStart).toHaveBeenCalledTimes(1); // never re-fired (flicker absorbed)
		expect(onEnd).toHaveBeenCalledTimes(1);
		expect(det.activeCount()).toBe(0);
	});

	it("swallows probe errors via onError", async () => {
		const onError = vi.fn();
		const det = new MeetingDetector({
			probe: () => Promise.reject(new Error("boom")),
			onStart: vi.fn(),
			onEnd: vi.fn(),
			onError,
		});
		await det.poll();
		expect(onError).toHaveBeenCalledOnce();
	});
});
