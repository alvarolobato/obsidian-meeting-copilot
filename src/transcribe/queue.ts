/**
 * A small, visible transcription queue.
 *
 * Transcriptions already run one at a time deep inside the vendored engine (its
 * endpoint/model seam is a process-global), but that serialization is opaque:
 * the plugin can't tell whether a run is *executing* or merely *waiting* behind
 * another, so the status bar claimed "Transcribing…" for every stacked job and
 * their progress callbacks fought over the same line (issue #62).
 *
 * This queue makes the ordering explicit and observable: exactly one job runs
 * at a time, the rest are "waiting", and a single {@link QueueSnapshot} is
 * emitted on every transition so the UI can label the active job and show the
 * others as queued. It also owns an {@link AbortController} per job so a running
 * or waiting transcription can be cancelled.
 *
 * It is deliberately UI- and Obsidian-agnostic (no imports) so the ordering and
 * cancellation logic is unit-testable without standing up the engine.
 */

/** The public description of a job, as surfaced to the UI. */
export interface QueueItem {
	/** Stable identifier; also the dedupe key (in practice the recording path). */
	id: string;
	/** Human-readable label for the status bar / dashboard (the meeting name). */
	label: string;
}

/** A point-in-time view of the queue, emitted on every transition. */
export interface QueueSnapshot {
	/** The job currently executing, or null when idle. */
	running: QueueItem | null;
	/** Jobs waiting to run, in the order they'll execute. */
	waiting: QueueItem[];
}

export interface TranscriptionJob extends QueueItem {
	/** The work to perform; receives a signal wired to {@link TranscriptionQueue.cancel}. */
	run: (signal: AbortSignal) => Promise<void>;
}

/** Error a waiting job's promise rejects with when it's cancelled before it runs. */
export class TranscriptionCancelledError extends Error {
	constructor() {
		super("Transcription cancelled");
		this.name = "TranscriptionCancelledError";
	}
}

interface Entry {
	id: string;
	label: string;
	run: (signal: AbortSignal) => Promise<void>;
	controller: AbortController;
	/** The caller-facing promise for this job, reused when a duplicate is enqueued. */
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

export class TranscriptionQueue {
	private waiting: Entry[] = [];
	private running: Entry | null = null;

	constructor(private readonly onChange?: (snapshot: QueueSnapshot) => void) {}

	/** True while a job with this id is running or waiting. */
	has(id: string): boolean {
		return this.running?.id === id || this.waiting.some((e) => e.id === id);
	}

	/** Number of jobs waiting to run (excludes the one currently running). */
	get waitingCount(): number {
		return this.waiting.length;
	}

	/** A snapshot of the current state (running + waiting), for late subscribers. */
	snapshot(): QueueSnapshot {
		return {
			running: this.running
				? { id: this.running.id, label: this.running.label }
				: null,
			waiting: this.waiting.map((e) => ({ id: e.id, label: e.label })),
		};
	}

	/**
	 * Enqueues a job and resolves when it finishes (or rejects if it fails or is
	 * cancelled). A job whose id is already queued/running is deduped: its
	 * existing run's promise is returned, so a double-trigger runs once but every
	 * caller still settles with that run's real outcome.
	 */
	enqueue(job: TranscriptionJob): Promise<void> {
		const existing =
			this.running?.id === job.id
				? this.running
				: this.waiting.find((e) => e.id === job.id);
		if (existing) return existing.promise;

		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		this.waiting.push({
			id: job.id,
			label: job.label,
			run: job.run,
			controller: new AbortController(),
			promise,
			resolve,
			reject,
		});
		this.emit();
		void this.pump();
		return promise;
	}

	/**
	 * Cancels a job by id. A waiting job is dropped and its promise rejected with
	 * {@link TranscriptionCancelledError}; the running job has its signal aborted
	 * and its own run decides how to settle. No-op for an unknown id.
	 */
	cancel(id: string): void {
		if (this.running?.id === id) {
			this.running.controller.abort();
			return;
		}
		const idx = this.waiting.findIndex((e) => e.id === id);
		if (idx === -1) return;
		const entry = this.waiting.splice(idx, 1)[0]!;
		entry.reject(new TranscriptionCancelledError());
		this.emit();
	}

	/** Cancels every job (running + waiting). Used on unload. */
	cancelAll(): void {
		this.running?.controller.abort();
		const dropped = this.waiting;
		this.waiting = [];
		for (const entry of dropped) {
			entry.reject(new TranscriptionCancelledError());
		}
		if (dropped.length > 0) this.emit();
	}

	private async pump(): Promise<void> {
		if (this.running) return;
		const next = this.waiting.shift();
		if (!next) return;
		this.running = next;
		this.emit();
		try {
			await next.run(next.controller.signal);
			next.resolve();
		} catch (e) {
			next.reject(e);
		} finally {
			this.running = null;
			this.emit();
			// Run the next waiting job on a fresh microtask so a synchronous
			// throw can't recurse the stack across a long backlog.
			void Promise.resolve().then(() => this.pump());
		}
	}

	private emit(): void {
		this.onChange?.(this.snapshot());
	}
}
