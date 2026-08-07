import { describe, expect, it } from "vitest";

import { maxRecordingAction, type MaxRecordingInput } from "./maxRecordingLength";

const base: MaxRecordingInput = {
	elapsedSeconds: 0,
	maxHours: 6,
	warningSeconds: 30,
	warningAlreadyShown: false,
	cancelled: false,
};

describe("maxRecordingAction", () => {
	it("does nothing well under the cap", () => {
		expect(maxRecordingAction({ ...base, elapsedSeconds: 30 * 60 })).toBe("none");
	});

	it("does nothing when the cap is disabled (0)", () => {
		expect(
			maxRecordingAction({ ...base, maxHours: 0, elapsedSeconds: 100 * 3600 })
		).toBe("none");
	});

	it("warns once the warning window is entered", () => {
		expect(
			maxRecordingAction({ ...base, elapsedSeconds: 6 * 3600 - 30 })
		).toBe("warn");
	});

	it("does not re-warn once the warning is already showing", () => {
		expect(
			maxRecordingAction({
				...base,
				elapsedSeconds: 6 * 3600 - 15,
				warningAlreadyShown: true,
			})
		).toBe("none");
	});

	it("stops once the cap is reached, even if the warning never fired", () => {
		expect(maxRecordingAction({ ...base, elapsedSeconds: 6 * 3600 })).toBe(
			"stop"
		);
	});

	it("stops well past the cap (e.g. after a machine sleep gap)", () => {
		expect(maxRecordingAction({ ...base, elapsedSeconds: 15 * 3600 })).toBe(
			"stop"
		);
	});

	it("stop takes priority over warn at the exact boundary", () => {
		expect(
			maxRecordingAction({
				...base,
				elapsedSeconds: 6 * 3600,
				warningAlreadyShown: false,
			})
		).toBe("stop");
	});

	it("does nothing once the user cancelled, even past the cap", () => {
		expect(
			maxRecordingAction({ ...base, elapsedSeconds: 20 * 3600, cancelled: true })
		).toBe("none");
	});
});
