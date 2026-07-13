import { describe, it, expect, vi } from "vitest";
import {
	QueueSnapshot,
	TranscriptionCancelledError,
	TranscriptionQueue,
} from "./queue";

/** A deferred whose resolution we control, to hold a job "running" in tests. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("TranscriptionQueue", () => {
	it("runs a single job and reports running then idle", async () => {
		const snapshots: QueueSnapshot[] = [];
		const q = new TranscriptionQueue((s) => snapshots.push(s));
		const d = deferred();
		const run = vi.fn(() => d.promise);
		const done = q.enqueue({ id: "a", label: "A", run });

		// Give the pump a microtask to start the job.
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);
		expect(q.snapshot().running?.id).toBe("a");

		d.resolve();
		await done;
		expect(q.snapshot().running).toBeNull();
		expect(q.snapshot().waiting).toHaveLength(0);
	});

	it("runs jobs strictly one at a time in order", async () => {
		const q = new TranscriptionQueue();
		const order: string[] = [];
		const a = deferred();
		const b = deferred();
		const pa = q.enqueue({ id: "a", label: "A", run: async () => { order.push("a-start"); await a.promise; order.push("a-end"); } });
		const pb = q.enqueue({ id: "b", label: "B", run: async () => { order.push("b-start"); await b.promise; order.push("b-end"); } });

		await Promise.resolve();
		// A is running, B waits.
		expect(order).toEqual(["a-start"]);
		expect(q.snapshot().running?.id).toBe("a");
		expect(q.snapshot().waiting.map((w) => w.id)).toEqual(["b"]);

		a.resolve();
		await pa;
		await Promise.resolve();
		expect(order).toEqual(["a-start", "a-end", "b-start"]);

		b.resolve();
		await pb;
		expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
	});

	it("dedupes an id that is already queued or running", async () => {
		const q = new TranscriptionQueue();
		const a = deferred();
		const run = vi.fn(() => a.promise);
		void q.enqueue({ id: "a", label: "A", run });
		void q.enqueue({ id: "a", label: "A again", run });
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);
		expect(q.has("a")).toBe(true);
		expect(q.waitingCount).toBe(0);
		a.resolve();
	});

	it("isolates a failing job from the rest of the queue", async () => {
		const q = new TranscriptionQueue();
		const pa = q.enqueue({ id: "a", label: "A", run: async () => { throw new Error("boom"); } });
		const ran = vi.fn(async () => {});
		const pb = q.enqueue({ id: "b", label: "B", run: ran });

		await expect(pa).rejects.toThrow("boom");
		await pb;
		expect(ran).toHaveBeenCalledTimes(1);
		expect(q.snapshot().running).toBeNull();
	});

	it("drops a waiting job on cancel and rejects its promise", async () => {
		const q = new TranscriptionQueue();
		const a = deferred();
		void q.enqueue({ id: "a", label: "A", run: () => a.promise });
		const bRun = vi.fn(async () => {});
		const pb = q.enqueue({ id: "b", label: "B", run: bRun });

		await Promise.resolve();
		q.cancel("b");
		await expect(pb).rejects.toBeInstanceOf(TranscriptionCancelledError);
		expect(q.waitingCount).toBe(0);

		a.resolve();
		await Promise.resolve();
		// B was cancelled while waiting, so it must never run.
		expect(bRun).not.toHaveBeenCalled();
	});

	it("aborts the running job's signal on cancel", async () => {
		const q = new TranscriptionQueue();
		let seenSignal: AbortSignal | null = null;
		const d = deferred();
		const p = q.enqueue({
			id: "a",
			label: "A",
			run: (signal) => {
				seenSignal = signal;
				signal.addEventListener("abort", () => d.resolve());
				return d.promise;
			},
		});
		await Promise.resolve();
		expect(seenSignal!.aborted).toBe(false);
		q.cancel("a");
		expect(seenSignal!.aborted).toBe(true);
		await p;
	});
});
