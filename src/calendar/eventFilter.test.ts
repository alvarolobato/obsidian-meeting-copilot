import { describe, it, expect } from "vitest";
import { shouldRecord, parseKeywords, isMeetingEventType } from "./eventFilter";

describe("shouldRecord", () => {
	it("records a normal timed event when there are no keywords", () => {
		expect(shouldRecord({ summary: "Team sync", allDay: false }, [])).toBe(true);
	});

	it("never records all-day events", () => {
		expect(shouldRecord({ summary: "Holiday", allDay: true }, [])).toBe(false);
	});

	it("excludes when the title contains a keyword (case-insensitive)", () => {
		expect(shouldRecord({ summary: "1on1 with Alice", allDay: false }, ["1ON1"])).toBe(false);
	});

	it("records when no keyword matches the title", () => {
		expect(shouldRecord({ summary: "Design review", allDay: false }, ["lunch", "1on1"])).toBe(true);
	});

	it("ignores blank keywords", () => {
		expect(shouldRecord({ summary: "anything", allDay: false }, ["", "  "])).toBe(true);
	});
});

describe("isMeetingEventType", () => {
	it("drops Google working-location events", () => {
		expect(isMeetingEventType("workingLocation")).toBe(false);
	});

	it("keeps regular meetings and unknown/undefined types", () => {
		expect(isMeetingEventType("default")).toBe(true);
		expect(isMeetingEventType(undefined)).toBe(true);
		expect(isMeetingEventType("focusTime")).toBe(true);
	});
});

describe("parseKeywords", () => {
	it("splits on newlines and commas and trims, dropping blanks", () => {
		expect(parseKeywords("lunch, 1on1\n  break \n\n,休憩")).toEqual(["lunch", "1on1", "break", "休憩"]);
	});

	it("returns an empty array for empty input", () => {
		expect(parseKeywords("")).toEqual([]);
	});
});
