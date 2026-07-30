/**
 * A tiny, fully-typed publish/subscribe bus. Each event name maps to a payload
 * type via the `Events` record, so `on`/`emit` are checked against the same
 * shape. Used to let plugin state notify the agenda view that it should reload
 * without coupling the two directly.
 */
export class TypedEventBus<Events extends Record<string, unknown>> {
	private readonly handlers = new Map<keyof Events, Set<(payload: never) => void>>();

	/**
	 * Register `handler` for `name`. Returns a disposer that removes exactly this
	 * registration (safe to call more than once).
	 */
	on<K extends keyof Events>(
		name: K,
		handler: (payload: Events[K]) => void
	): () => void {
		let bucket = this.handlers.get(name);
		if (!bucket) {
			bucket = new Set();
			this.handlers.set(name, bucket);
		}
		const fn = handler as (payload: never) => void;
		bucket.add(fn);
		return () => {
			this.handlers.get(name)?.delete(fn);
		};
	}

	/** Notify every handler registered for `name`. Handler throws are contained. */
	emit<K extends keyof Events>(name: K, payload: Events[K]): void {
		const bucket = this.handlers.get(name);
		if (!bucket) return;
		for (const fn of [...bucket]) {
			try {
				(fn as (p: Events[K]) => void)(payload);
			} catch (err) {
				console.warn("[Meeting Copilot] event handler threw", err);
			}
		}
	}

	/** Drop every registration on every event. */
	clear(): void {
		this.handlers.clear();
	}
}
