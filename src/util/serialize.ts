/**
 * Returns a wrapper that runs the given async tasks strictly one at a time, in
 * call order. A task's rejection is isolated: it propagates to that call's
 * caller but does not break the chain for subsequent tasks.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(task: () => Promise<T>): Promise<T> => {
		const run = tail.then(task);
		tail = run.catch(() => undefined);
		return run;
	};
}
