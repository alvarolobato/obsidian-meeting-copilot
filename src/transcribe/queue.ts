/**
 * A small, visible task queue for long-running background work.
 *
 * Transcriptions already run one at a time deep inside the vendored engine (its
 * endpoint/model seam is a process-global), but that serialization is opaque:
 * the plugin can't tell whether a run is *executing* or merely *waiting* behind
 * another, so the status bar claimed "Transcribing…" for every stacked job and
 * their progress callbacks fought over the same line (issue #62).
 *
 * This queue makes the ordering explicit and observable: exactly one task runs
 * at a time, the rest are "waiting", and a single {@link QueueSnapshot} is
 * emitted on every transition so the UI can label the active task and show the
 * others as queued. It also owns an {@link AbortController} per task so a
 * running or waiting task can be cancelled.
 *
 * It is generic over task *kind* (issue #96): transcription and enrichment (and
 * any future long task) share the one queue, one visible popover, and the same
 * per-item cancel. A task may declare a {@link QueueTask.dependsOn} on another
 * task's id — the enrich-after-transcribe pipeline — so it won't start until
 * that task has finished *successfully*; if the dependency fails or is
 * cancelled, the dependent is dropped (cancelled) too.
 *
 * It is deliberately UI- and Obsidian-agnostic (no imports) so the ordering,
 * dependency, and cancellation logic is unit-testable without standing up the
 * engine.
 */

/** The kind of work a task performs, used for the row's verb/icon in the UI. */
export type TaskKind = "transcribe" | "enrich";

/** The public description of a task, as surfaced to the UI. */
export interface QueueItem {
	/** Stable identifier; also the dedupe key (in practice a kind-scoped path). */
	id: string;
	/** Human-readable label for the status bar / popover (the meeting name). */
	label: string;
	/** What the task does, so the UI can pick a verb ("Transcribing"/"Enriching"). */
	kind: TaskKind;
}

/** A point-in-time view of the queue, emitted on every transition. */
export interface QueueSnapshot {
	/** The task currently executing, or null when idle. */
	running: QueueItem | null;
	/** Tasks waiting to run, in the order they'll execute. */
	waiting: QueueItem[];
}

export interface QueueTask extends QueueItem {
	/** The work to perform; receives a signal wired to {@link TaskQueue.cancel}. */
	run: (signal: AbortSignal) => Promise<void>;
	/**
	 * Id of a task that must finish *successfully* before this one runs. While
	 * that task is still queued or running this task stays waiting; if it fails
	 * or is cancelled, this task is dropped (cancelled) too. Unknown/absent id →
	 * this task is immediately eligible (the dependency already settled).
	 */
	dependsOn?: string;
}

/** Error a task's promise rejects with when it's cancelled before/while it runs. */
export class TaskCancelledError extends Error {
	constructor() {
		super("Task cancelled");
		this.name = "TaskCancelledError";
	}
}

interface Entry {
	id: string;
	label: string;
	kind: TaskKind;
	run: (signal: AbortSignal) => Promise<void>;
	dependsOn?: string;
	controller: AbortController;
	/** The caller-facing promise for this task, reused when a duplicate is enqueued. */
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

export class TaskQueue {
	private waiting: Entry[] = [];
	private running: Entry | null = null;

	constructor(private readonly onChange?: (snapshot: QueueSnapshot) => void) {}

	/** True while a task with this id is running or waiting. */
	has(id: string): boolean {
		return this.isPending(id);
	}

	/** Number of tasks waiting to run (excludes the one currently running). */
	get waitingCount(): number {
		return this.waiting.length;
	}

	/** A snapshot of the current state (running + waiting), for late subscribers. */
	snapshot(): QueueSnapshot {
		return {
			running: this.running ? toItem(this.running) : null,
			waiting: this.waiting.map(toItem),
		};
	}

	/**
	 * Enqueues a task and resolves when it finishes (or rejects if it fails or is
	 * cancelled). A task whose id is already queued/running is deduped: its
	 * existing run's promise is returned, so a double-trigger runs once but every
	 * caller still settles with that run's real outcome.
	 */
	enqueue(task: QueueTask): Promise<void> {
		const existing =
			this.running?.id === task.id
				? this.running
				: this.waiting.find((e) => e.id === task.id);
		if (existing) return existing.promise;

		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		this.waiting.push({
			id: task.id,
			label: task.label,
			kind: task.kind,
			run: task.run,
			dependsOn: task.dependsOn,
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
	 * Cancels a task by id. A waiting task is dropped and its promise rejected
	 * with {@link TaskCancelledError} (and so are any tasks that depended on it);
	 * the running task has its signal aborted and its own run decides how to
	 * settle (its dependents are dropped when it rejects). No-op for an unknown id.
	 */
	cancel(id: string): void {
		if (this.running?.id === id) {
			// pump()'s catch drops the running task's dependents once it rejects.
			this.running.controller.abort();
			return;
		}
		const idx = this.waiting.findIndex((e) => e.id === id);
		if (idx === -1) return;
		const entry = this.waiting.splice(idx, 1)[0]!;
		entry.reject(new TaskCancelledError());
		this.dropDependents(id);
		this.emit();
	}

	/** Cancels every task (running + waiting). Used on unload. */
	cancelAll(): void {
		this.running?.controller.abort();
		const dropped = this.waiting;
		this.waiting = [];
		for (const entry of dropped) {
			entry.reject(new TaskCancelledError());
		}
		if (dropped.length > 0) this.emit();
	}

	private async pump(): Promise<void> {
		if (this.running) return;
		const idx = this.nextEligibleIndex();
		if (idx === -1) return;
		const next = this.waiting.splice(idx, 1)[0]!;
		this.running = next;
		this.emit();
		try {
			await next.run(next.controller.signal);
			next.resolve();
		} catch (e) {
			next.reject(e);
			// A failed/cancelled task can't satisfy anything waiting on it, so
			// drop those dependents (transitively) rather than block forever.
			this.dropDependents(next.id);
		} finally {
			this.running = null;
			this.emit();
			// Run the next eligible task on a fresh microtask so a synchronous
			// throw can't recurse the stack across a long backlog.
			void Promise.resolve().then(() => this.pump());
		}
	}

	/**
	 * The first waiting task that can run now: one with no dependency, or whose
	 * dependency has already left the queue (finished successfully — a failed one
	 * would have dropped this task). Returns -1 when every waiting task is still
	 * blocked on a dependency that's queued/running (that dependency runs first).
	 */
	private nextEligibleIndex(): number {
		for (let i = 0; i < this.waiting.length; i++) {
			const dep = this.waiting[i]!.dependsOn;
			if (!dep || !this.isPending(dep)) return i;
		}
		return -1;
	}

	/** True while a task with this id is running or waiting (its outcome is pending). */
	private isPending(id: string): boolean {
		return this.running?.id === id || this.waiting.some((e) => e.id === id);
	}

	/**
	 * Rejects (as cancelled) every waiting task that transitively depended on a
	 * task that just failed/was cancelled, so a broken pipeline doesn't strand
	 * dependents in the queue forever.
	 */
	private dropDependents(rootId: string): void {
		const dropped = new Set<string>([rootId]);
		let changed = true;
		while (changed) {
			changed = false;
			for (let i = this.waiting.length - 1; i >= 0; i--) {
				const e = this.waiting[i]!;
				if (e.dependsOn && dropped.has(e.dependsOn)) {
					this.waiting.splice(i, 1);
					e.reject(new TaskCancelledError());
					dropped.add(e.id);
					changed = true;
				}
			}
		}
	}

	private emit(): void {
		this.onChange?.(this.snapshot());
	}
}

function toItem(entry: Entry): QueueItem {
	return { id: entry.id, label: entry.label, kind: entry.kind };
}
