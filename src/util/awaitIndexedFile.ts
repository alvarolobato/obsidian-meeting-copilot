/**
 * Waits for a just-written vault file to become resolvable through Obsidian's
 * index, tolerant of arbitrary index lag.
 *
 * The recorder helper writes audio from a *separate* process straight to disk,
 * so Obsidian only learns of the file when its file watcher fires. That's
 * usually a second or two, but can be far longer — a vault on cloud sync
 * (iCloud/Dropbox) or a network drive has a sluggish watcher, and a backgrounded
 * app during a meeting has its watcher + timers throttled by macOS App Nap. A
 * fixed poll (the old 10 s) loses that race and silently drops the headline
 * auto-transcribe (issue #29).
 *
 * This resolves the moment the file is indexed — driven by the vault `create`
 * event, with a slow poll as a backstop and a hard cap so the wait can't dangle
 * forever. Crucially it only *waits* when the file is confirmed **on disk**; a
 * path that isn't on disk at all (a genuine wrong-path / never-written bug)
 * resolves `null` promptly instead of blocking for the whole cap.
 */
export interface IndexedFileDeps<T> {
	/** The indexed file at `path`, or `null` if the index doesn't have it yet. */
	getIndexed: (path: string) => T | null;
	/** Whether `path` exists on disk (adapter), independent of the index. */
	existsOnDisk: (path: string) => Promise<boolean>;
	/**
	 * Subscribe to file-created events, invoking `cb` with each created file's
	 * vault path. Returns an unsubscribe function.
	 */
	onCreate: (cb: (createdPath: string) => void) => () => void;
	/** `window.setTimeout` (injected so the wait is unit-testable). */
	setTimeout: (fn: () => void, ms: number) => number;
	clearTimeout: (handle: number) => void;
}

export interface AwaitIndexedFileOptions {
	/** Hard cap on the total wait before giving up. Default 5 min. */
	capMs?: number;
	/** Backstop poll interval. Default 1 s. */
	pollMs?: number;
	/** Aborts the wait (e.g. a manual transcribe superseded it). Resolves `null`. */
	signal?: AbortSignal;
}

export async function awaitIndexedFile<T>(
	path: string,
	deps: IndexedFileDeps<T>,
	opts: AwaitIndexedFileOptions = {}
): Promise<T | null> {
	const capMs = opts.capMs ?? 5 * 60_000;
	const pollMs = opts.pollMs ?? 1_000;
	const { signal } = opts;

	if (signal?.aborted) return null;

	const immediate = deps.getIndexed(path);
	if (immediate !== null) return immediate;

	// Not indexed — but is it even on disk? If not, there's nothing to wait for
	// (wrong path / never written); re-check the index once in case it landed
	// during the exists() await, then give up so a real bug surfaces promptly.
	if (!(await deps.existsOnDisk(path))) {
		return deps.getIndexed(path);
	}
	if (signal?.aborted) return deps.getIndexed(path);

	return new Promise<T | null>((resolve) => {
		let settled = false;
		let pollHandle: number | null = null;
		let capHandle: number | null = null;
		let unsubscribe: (() => void) | null = null;
		let onAbort: (() => void) | null = null;

		const finish = (result: T | null): void => {
			if (settled) return;
			settled = true;
			if (pollHandle !== null) deps.clearTimeout(pollHandle);
			if (capHandle !== null) deps.clearTimeout(capHandle);
			unsubscribe?.();
			if (onAbort && signal) signal.removeEventListener("abort", onAbort);
			resolve(result);
		};

		const check = (): void => {
			const f = deps.getIndexed(path);
			if (f !== null) finish(f);
		};

		// Self-rescheduling poll (one pending timer at a time) as a backstop for
		// a `create` event that fired before we subscribed, or an unreliable
		// watcher.
		const schedulePoll = (): void => {
			pollHandle = deps.setTimeout(() => {
				if (settled) return;
				const f = deps.getIndexed(path);
				if (f !== null) {
					finish(f);
					return;
				}
				schedulePoll();
			}, pollMs);
		};

		unsubscribe = deps.onCreate((createdPath) => {
			if (createdPath === path) check();
		});
		capHandle = deps.setTimeout(() => finish(deps.getIndexed(path)), capMs);
		if (signal) {
			onAbort = () => finish(deps.getIndexed(path));
			signal.addEventListener("abort", onAbort, { once: true });
		}
		schedulePoll();
		// Guard the window between the on-disk check and subscribing: the file may
		// have been indexed already.
		check();
	});
}
