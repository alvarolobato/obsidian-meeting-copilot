/**
 * Tier 1 meeting detection: tracks which conferencing apps currently have a
 * meeting *in progress* and fires start/end callbacks on transitions.
 *
 * The detector itself is timer- and OS-agnostic (the plugin drives `poll()` on
 * an interval and supplies the probe), so the transition logic is unit-testable
 * with a mocked probe. See `probe.ts` for the macOS signals.
 */
export interface MeetingDetectorDeps {
	/** Returns the set of app names ("Zoom", "Google Meet", …) currently in a meeting. */
	probe: () => Promise<Set<string>>;
	/** Fired once when an app transitions into a meeting. */
	onStart: (app: string) => void;
	/** Fired once when an app's meeting ends (after the miss threshold). */
	onEnd: (app: string) => void;
	/** Optional error sink for probe failures. */
	onError?: (e: unknown) => void;
	/**
	 * How many consecutive polls an active app must be absent before `onEnd`
	 * fires. Guards against probe flicker (a transient pgrep/osascript failure)
	 * prematurely stopping a recording. Default 2.
	 */
	endMissThreshold?: number;
}

export class MeetingDetector {
	private active = new Set<string>();
	/** Consecutive missed polls per active app (for end hysteresis). */
	private misses = new Map<string, number>();
	private polling = false;
	private readonly endMissThreshold: number;

	constructor(private readonly deps: MeetingDetectorDeps) {
		this.endMissThreshold = Math.max(1, deps.endMissThreshold ?? 2);
	}

	/** One detection pass. Safe to call on an interval; overlapping calls are ignored. */
	async poll(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			const current = await this.deps.probe();
			for (const app of current) {
				if (!this.active.has(app)) {
					this.active.add(app);
					this.deps.onStart(app);
				}
				this.misses.delete(app);
			}
			for (const app of [...this.active]) {
				if (current.has(app)) continue;
				const misses = (this.misses.get(app) ?? 0) + 1;
				if (misses >= this.endMissThreshold) {
					this.active.delete(app);
					this.misses.delete(app);
					this.deps.onEnd(app);
				} else {
					this.misses.set(app, misses);
				}
			}
		} catch (e) {
			this.deps.onError?.(e);
		} finally {
			this.polling = false;
		}
	}

	/** True while the given app is considered in a meeting. */
	isActive(app: string): boolean {
		return this.active.has(app);
	}

	/** Number of apps currently considered in a meeting. */
	activeCount(): number {
		return this.active.size;
	}

	/**
	 * Drops tracking for any active app not in `apps` WITHOUT firing `onEnd`.
	 * Used when a probe is disabled: a disabled app isn't "ended", it's just no
	 * longer watched, so it must not trigger an end transition (which could stop
	 * a still-live recording).
	 */
	retainOnly(apps: Set<string>): void {
		for (const app of [...this.active]) {
			if (!apps.has(app)) {
				this.active.delete(app);
				this.misses.delete(app);
			}
		}
	}
}
