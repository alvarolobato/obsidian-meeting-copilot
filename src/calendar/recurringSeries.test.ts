import { describe, expect, it } from "vitest";
import { seriesKey } from "./recurringSeries";

describe("seriesKey", () => {
	it("strips a lineage-split suffix", () => {
		expect(seriesKey("2ic6u9p8r1rlhvfv7k35u2716s_R20260730T140000")).toBe(
			"2ic6u9p8r1rlhvfv7k35u2716s"
		);
	});

	it("returns an unsuffixed id unchanged", () => {
		expect(seriesKey("2ic6u9p8r1rlhvfv7k35u2716s")).toBe(
			"2ic6u9p8r1rlhvfv7k35u2716s"
		);
	});

	it("collapses two different lineages of the same series to the same key", () => {
		const a = seriesKey("8ea8oplmgruqkju0nkfl4fknvl_R20260729T150000");
		const b = seriesKey("8ea8oplmgruqkju0nkfl4fknvl_R20260715T150000");
		expect(a).toBe(b);
	});

	it("keeps two genuinely different series apart", () => {
		const a = seriesKey("2ic6u9p8r1rlhvfv7k35u2716s_R20260730T140000");
		const b = seriesKey("8ea8oplmgruqkju0nkfl4fknvl_R20260715T150000");
		expect(a).not.toBe(b);
	});
});
