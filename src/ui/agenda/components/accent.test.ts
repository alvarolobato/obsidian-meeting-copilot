import { describe, expect, it } from "vitest";
import { accentClass, accentFor } from "./accent";

describe("accentFor", () => {
	it("returns one-on-one before recurring", () => {
		expect(
			accentFor({
				oneOnOnePartner: "Bob",
				recurringEventId: "series-1",
				attendees: ["Bob", "Me"],
			} as never)
		).toBe("one-on-one");
	});

	it("returns recurring for a series instance", () => {
		expect(
			accentFor({
				oneOnOnePartner: null,
				recurringEventId: "series-1",
				attendees: ["A", "B", "C"],
			} as never)
		).toBe("recurring");
	});

	it("returns block for a solo event", () => {
		expect(
			accentFor({
				oneOnOnePartner: null,
				recurringEventId: null,
				attendees: [],
			} as never)
		).toBe("block");
	});

	it("returns meeting for a one-off group event", () => {
		expect(
			accentFor({
				oneOnOnePartner: null,
				recurringEventId: null,
				attendees: ["A", "B"],
			} as never)
		).toBe("meeting");
	});
});

describe("accentClass", () => {
	it("maps keys to mc-cal accent classes", () => {
		expect(accentClass("one-on-one")).toBe("mc-cal-accent-one-on-one");
		expect(accentClass("recurring")).toBe("mc-cal-accent-recurring");
		expect(accentClass("meeting")).toBe("mc-cal-accent-meeting");
	});
});
