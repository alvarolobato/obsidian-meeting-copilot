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
	/** Fired once when an app's meeting ends. */
	onEnd: (app: string) => void;
	/** Optional error sink for probe failures. */
	onError?: (e: unknown) => void;
}

export class MeetingDetector {
	private active = new Set<string>();
	private polling = false;

	constructor(private readonly deps: MeetingDetectorDeps) {}

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
			}
			for (const app of [...this.active]) {
				if (!current.has(app)) {
					this.active.delete(app);
					this.deps.onEnd(app);
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
}
