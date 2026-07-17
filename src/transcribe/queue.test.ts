import { describe, it, expect, vi } from "vitest";
import {
	QueueSnapshot,
	QueueTask,
	TaskCancelledError,
	TaskQueue,
} from "./queue";

/** A deferred whose resolution we control, to hold a task "running" in tests. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Build a task, defaulting the kind so existing cases stay terse. */
function task(partial: Omit<QueueTask, "kind"> & { kind?: QueueTask["kind"] }): QueueTask {
	return { kind: "transcribe", ...partial };
}

describe("TaskQueue", () => {
	it("runs a single task and reports running then idle", async () => {
		const snapshots: QueueSnapshot[] = [];
		const q = new TaskQueue((s) => snapshots.push(s));
		const d = deferred();
		const run = vi.fn(() => d.promise);
		const done = q.enqueue(task({ id: "a", label: "A", run }));

		// Give the pump a microtask to start the task.
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);
		expect(q.snapshot().running?.id).toBe("a");

		d.resolve();
		await done;
		expect(q.snapshot().running).toBeNull();
		expect(q.snapshot().waiting).toHaveLength(0);
	});

	it("carries the task kind through to the snapshot", async () => {
		const q = new TaskQueue();
		const d = deferred();
		void q.enqueue(task({ id: "e", label: "E", kind: "enrich", run: () => d.promise }));
		await Promise.resolve();
		expect(q.snapshot().running?.kind).toBe("enrich");
		d.resolve();
	});

	it("runs tasks strictly one at a time in order", async () => {
		const q = new TaskQueue();
		const order: string[] = [];
		const a = deferred();
		const b = deferred();
		const pa = q.enqueue(task({ id: "a", label: "A", run: async () => { order.push("a-start"); await a.promise; order.push("a-end"); } }));
		const pb = q.enqueue(task({ id: "b", label: "B", run: async () => { order.push("b-start"); await b.promise; order.push("b-end"); } }));

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

	it("dedupes an id that is already queued or running, settling both callers", async () => {
		const q = new TaskQueue();
		const a = deferred();
		const run = vi.fn(() => a.promise);
		const p1 = q.enqueue(task({ id: "a", label: "A", run }));
		const p2 = q.enqueue(task({ id: "a", label: "A again", run }));
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);
		expect(q.has("a")).toBe(true);
		expect(q.waitingCount).toBe(0);

		// The deduped caller must settle with the real run's outcome, not early.
		let p2Settled = false;
		void p2.then(() => (p2Settled = true));
		await Promise.resolve();
		expect(p2Settled).toBe(false);

		a.resolve();
		await Promise.all([p1, p2]);
		expect(p2Settled).toBe(true);
	});

	it("isolates a failing task from the rest of the queue", async () => {
		const q = new TaskQueue();
		const pa = q.enqueue(task({ id: "a", label: "A", run: async () => { throw new Error("boom"); } }));
		const ran = vi.fn(async () => {});
		const pb = q.enqueue(task({ id: "b", label: "B", run: ran }));

		await expect(pa).rejects.toThrow("boom");
		await pb;
		expect(ran).toHaveBeenCalledTimes(1);
		expect(q.snapshot().running).toBeNull();
	});

	it("drops a waiting task on cancel and rejects its promise", async () => {
		const q = new TaskQueue();
		const a = deferred();
		void q.enqueue(task({ id: "a", label: "A", run: () => a.promise }));
		const bRun = vi.fn(async () => {});
		const pb = q.enqueue(task({ id: "b", label: "B", run: bRun }));

		await Promise.resolve();
		q.cancel("b");
		await expect(pb).rejects.toBeInstanceOf(TaskCancelledError);
		expect(q.waitingCount).toBe(0);

		a.resolve();
		await Promise.resolve();
		// B was cancelled while waiting, so it must never run.
		expect(bRun).not.toHaveBeenCalled();
	});

	it("aborts the running task's signal on cancel", async () => {
		const q = new TaskQueue();
		let seenSignal: AbortSignal | null = null;
		const d = deferred();
		const p = q.enqueue(task({
			id: "a",
			label: "A",
			run: (signal) => {
				seenSignal = signal;
				signal.addEventListener("abort", () => d.resolve());
				return d.promise;
			},
		}));
		await Promise.resolve();
		expect(seenSignal!.aborted).toBe(false);
		q.cancel("a");
		expect(seenSignal!.aborted).toBe(true);
		await p;
	});

	describe("dependencies (transcribe → enrich pipeline)", () => {
		it("holds a dependent task until its dependency succeeds, then runs it", async () => {
			const q = new TaskQueue();
			const order: string[] = [];
			const dep = deferred();
			const pDep = q.enqueue(task({ id: "t", label: "T", run: async () => { order.push("t"); await dep.promise; } }));
			const enrichRun = vi.fn(async () => { order.push("e"); });
			const pEnrich = q.enqueue(task({ id: "e", label: "E", kind: "enrich", run: enrichRun, dependsOn: "t" }));

			await Promise.resolve();
			// Transcribe runs; enrich waits on it.
			expect(order).toEqual(["t"]);
			expect(enrichRun).not.toHaveBeenCalled();
			expect(q.snapshot().waiting.map((w) => w.id)).toEqual(["e"]);

			dep.resolve();
			await pDep;
			await pEnrich;
			expect(order).toEqual(["t", "e"]);
		});

		it("drops a dependent (as cancelled) when its dependency fails", async () => {
			const q = new TaskQueue();
			const pDep = q.enqueue(task({ id: "t", label: "T", run: async () => { throw new Error("transcribe failed"); } }));
			const enrichRun = vi.fn(async () => {});
			const pEnrich = q.enqueue(task({ id: "e", label: "E", kind: "enrich", run: enrichRun, dependsOn: "t" }));

			await expect(pDep).rejects.toThrow("transcribe failed");
			await expect(pEnrich).rejects.toBeInstanceOf(TaskCancelledError);
			expect(enrichRun).not.toHaveBeenCalled();
			expect(q.snapshot().running).toBeNull();
			expect(q.waitingCount).toBe(0);
		});

		it("drops a dependent when its dependency is cancelled while waiting", async () => {
			const q = new TaskQueue();
			const blocker = deferred();
			// A blocker keeps the slot busy so both t and e stay waiting.
			q.enqueue(task({ id: "blk", label: "Blk", run: () => blocker.promise })).catch(() => {});
			// `t` is cancelled below; swallow its rejection so it isn't "unhandled".
			q.enqueue(task({ id: "t", label: "T", run: async () => {} })).catch(() => {});
			const enrichRun = vi.fn(async () => {});
			const pEnrich = q.enqueue(task({ id: "e", label: "E", kind: "enrich", run: enrichRun, dependsOn: "t" }));

			await Promise.resolve();
			q.cancel("t");
			await expect(pEnrich).rejects.toBeInstanceOf(TaskCancelledError);

			blocker.resolve();
			await Promise.resolve();
			await Promise.resolve();
			expect(enrichRun).not.toHaveBeenCalled();
		});

		it("runs a dependent immediately when its dependency id was never enqueued", async () => {
			const q = new TaskQueue();
			const enrichRun = vi.fn(async () => {});
			const pEnrich = q.enqueue(task({ id: "e", label: "E", kind: "enrich", run: enrichRun, dependsOn: "missing" }));
			await pEnrich;
			expect(enrichRun).toHaveBeenCalledTimes(1);
		});

		it("drops a whole transitive chain when the root dependency fails", async () => {
			const q = new TaskQueue();
			const pRoot = q.enqueue(task({ id: "t", label: "T", run: async () => { throw new Error("boom"); } }));
			const pMid = q.enqueue(task({ id: "e", label: "E", kind: "enrich", run: async () => {}, dependsOn: "t" }));
			const pLeaf = q.enqueue(task({ id: "e2", label: "E2", kind: "enrich", run: async () => {}, dependsOn: "e" }));

			await expect(pRoot).rejects.toThrow("boom");
			await expect(pMid).rejects.toBeInstanceOf(TaskCancelledError);
			await expect(pLeaf).rejects.toBeInstanceOf(TaskCancelledError);
			expect(q.waitingCount).toBe(0);
		});
	});
});
