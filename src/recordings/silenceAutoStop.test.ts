import { describe, expect, it } from "vitest";

import { silenceAutoStopAction, type SilenceAutoStopInput } from "./silenceAutoStop";

const base: SilenceAutoStopInput = {
	silentSeconds: 0,
	thresholdMinutes: 10,
	warningSeconds: 30,
	warningAlreadyShown: false,
	cancelled: false,
};

describe("silenceAutoStopAction", () => {
	it("does nothing while there's recent speech", () => {
		expect(silenceAutoStopAction({ ...base, silentSeconds: 60 })).toBe("none");
	});

	it("does nothing when the cap is disabled (0)", () => {
		expect(
			silenceAutoStopAction({ ...base, thresholdMinutes: 0, silentSeconds: 3600 })
		).toBe("none");
	});

	it("warns once the warning window is entered", () => {
		expect(silenceAutoStopAction({ ...base, silentSeconds: 10 * 60 - 30 })).toBe(
			"warn"
		);
	});

	it("does not re-warn once the warning is already showing", () => {
		expect(
			silenceAutoStopAction({
				...base,
				silentSeconds: 10 * 60 - 10,
				warningAlreadyShown: true,
			})
		).toBe("none");
	});

	it("stops once the threshold is reached, even if the warning never fired", () => {
		expect(silenceAutoStopAction({ ...base, silentSeconds: 10 * 60 })).toBe(
			"stop"
		);
	});

	it("stops well past the threshold (e.g. a missed status heartbeat)", () => {
		expect(silenceAutoStopAction({ ...base, silentSeconds: 60 * 60 })).toBe(
			"stop"
		);
	});

	it("does nothing once the user cancelled, even past the threshold", () => {
		expect(
			silenceAutoStopAction({ ...base, silentSeconds: 20 * 60, cancelled: true })
		).toBe("none");
	});
});
