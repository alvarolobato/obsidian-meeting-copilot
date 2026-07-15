import { describe, it, expect } from "vitest";
import {
	startDualChannelPrompt,
	DualChannelTimers,
	InAppHandle,
} from "./dualChannelPrompt";

/** Deterministic timer harness: nothing fires until `fire()` is called. */
function fakeTimers(): DualChannelTimers & {
	fire: () => void;
	pending: () => number;
} {
	const scheduled = new Map<number, () => void>();
	let nextId = 1;
	return {
		setTimeout: (fn: () => void) => {
			const id = nextId++;
			scheduled.set(id, fn);
			return id;
		},
		clearTimeout: (id: number) => {
			scheduled.delete(id);
		},
		fire: () => {
			for (const [id, fn] of [...scheduled]) {
				scheduled.delete(id);
				fn();
			}
		},
		pending: () => scheduled.size,
	};
}

function trackedInApp(): {
	make: () => InAppHandle;
	shows: () => number;
	hides: () => number;
} {
	let shows = 0;
	let hides = 0;
	return {
		make: (): InAppHandle => {
			shows++;
			return {
				hide: (): void => {
					hides++;
				},
			};
		},
		shows: () => shows,
		hides: () => hides,
	};
}

describe("startDualChannelPrompt", () => {
	it("skips the in-app notice when the OS notification is confirmed shown first", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		ctrl.osShown();

		expect(inApp.shows()).toBe(0);
		expect(timers.pending()).toBe(0); // timer cancelled
		// A late timer firing must not resurrect the notice.
		timers.fire();
		expect(inApp.shows()).toBe(0);
	});

	it("hides the in-app notice if the OS notification confirms after the fallback showed it", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		timers.fire(); // delay elapsed → in-app shown
		expect(inApp.shows()).toBe(1);
		expect(inApp.hides()).toBe(0);

		ctrl.osShown(); // OS confirmed late → dedupe by hiding the in-app one
		expect(inApp.hides()).toBe(1);
	});

	it("shows the in-app notice immediately when the OS notification fails", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		ctrl.osFailed();

		expect(inApp.shows()).toBe(1);
		expect(timers.pending()).toBe(0);
	});

	it("falls back to the in-app notice when the OS notification never confirms", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		timers.fire(); // no osShown/osFailed within the grace window
		expect(inApp.shows()).toBe(1);
	});

	it("dispose cancels a pending timer and hides a shown notice", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		// Before the timer fires: dispose cancels it, nothing shown.
		ctrl.dispose();
		expect(timers.pending()).toBe(0);
		expect(inApp.shows()).toBe(0);

		// A separate prompt that has already shown its notice gets hidden on dispose.
		const inApp2 = trackedInApp();
		const ctrl2 = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp2.make,
		});
		timers.fire();
		expect(inApp2.shows()).toBe(1);
		ctrl2.dispose();
		expect(inApp2.hides()).toBe(1);
	});

	it("is idempotent — the first outcome wins", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		ctrl.osShown();
		ctrl.osFailed(); // ignored — already settled
		ctrl.osShown();

		expect(inApp.shows()).toBe(0);
	});

	it("does not show a second in-app notice when osFailed lands after the timer already showed one", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		timers.fire(); // fallback shows the in-app notice
		expect(inApp.shows()).toBe(1);
		ctrl.osFailed(); // late failure — must not create a duplicate
		expect(inApp.shows()).toBe(1);
	});

	it("ignores osShown / osFailed that arrive after dispose", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		ctrl.dispose();
		ctrl.osFailed(); // no-op — already torn down
		ctrl.osShown();
		expect(inApp.shows()).toBe(0);
	});

	it("forceInApp shows the notice on demand and dispose still hides it", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		// OS confirmed shown (in-app skipped), then the user clicks the body.
		ctrl.osShown();
		expect(inApp.shows()).toBe(0);
		ctrl.forceInApp();
		expect(inApp.shows()).toBe(1);
		// A second body click doesn't stack another notice.
		ctrl.forceInApp();
		expect(inApp.shows()).toBe(1);

		ctrl.dispose();
		expect(inApp.hides()).toBe(1);
	});

	it("keeps a user-forced in-app notice even when osShown confirms afterwards", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		// User clicks the OS body before the async `show` confirmation arrives.
		ctrl.forceInApp();
		expect(inApp.shows()).toBe(1);
		ctrl.osShown(); // late confirmation must NOT hide what the user asked for
		expect(inApp.hides()).toBe(0);
	});

	it("forceInApp after dispose is a no-op (no orphaned notice)", () => {
		const timers = fakeTimers();
		const inApp = trackedInApp();
		const ctrl = startDualChannelPrompt({
			fallbackDelayMs: 500,
			timers,
			showInApp: inApp.make,
		});

		ctrl.dispose();
		ctrl.forceInApp(); // late click on a superseded/handled prompt
		expect(inApp.shows()).toBe(0);
	});
});
