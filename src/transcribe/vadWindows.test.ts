import { describe, expect, it } from "vitest";

import { exceedsVadDurationLimit } from "./vadWindows";

describe("exceedsVadDurationLimit", () => {
	it("allows two short streams", () => {
		expect(exceedsVadDurationLimit(30 * 60, 30 * 60)).toBe(false);
	});

	it("allows a stream right at the limit", () => {
		expect(exceedsVadDurationLimit(3 * 60 * 60, 3 * 60 * 60)).toBe(false);
	});

	it("rejects when either stream exceeds the limit", () => {
		expect(exceedsVadDurationLimit(3 * 60 * 60 + 1, 30 * 60)).toBe(true);
		expect(exceedsVadDurationLimit(30 * 60, 3 * 60 * 60 + 1)).toBe(true);
	});

	it("rejects a real 15h mistaken-recording-length stream", () => {
		expect(exceedsVadDurationLimit(15 * 60 * 60, 15 * 60 * 60)).toBe(true);
	});

	it("treats an unknown (null) duration as unsafe", () => {
		expect(exceedsVadDurationLimit(null, 30 * 60)).toBe(true);
		expect(exceedsVadDurationLimit(30 * 60, null)).toBe(true);
		expect(exceedsVadDurationLimit(null, null)).toBe(true);
	});
});
