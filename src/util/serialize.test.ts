import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serialize";

describe("createSerialQueue", () => {
	it("runs tasks one at a time in order", async () => {
		const serial = createSerialQueue();
		const events: string[] = [];
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((r) => (releaseFirst = r));

		const p1 = serial(async () => {
			events.push("start1");
			await firstGate;
			events.push("end1");
		});
		const p2 = serial(async () => {
			events.push("start2");
		});

		// Let the first task start (queue dispatches on a microtask).
		await new Promise((r) => setTimeout(r, 0));
		// The second task must not start until the first finishes.
		expect(events).toEqual(["start1"]);
		releaseFirst();
		await Promise.all([p1, p2]);
		expect(events).toEqual(["start1", "end1", "start2"]);
	});

	it("keeps the chain alive after a rejection and propagates it to the caller", async () => {
		const serial = createSerialQueue();
		const failing = serial(() => Promise.reject(new Error("boom")));
		await expect(failing).rejects.toThrow("boom");

		const ok = serial(() => Promise.resolve("next"));
		await expect(ok).resolves.toBe("next");
	});
});
