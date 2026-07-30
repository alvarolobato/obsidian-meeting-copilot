import { describe, it, expect } from "vitest";
import type { AgendaMeeting } from "../agendaModel";
import { avatarInitial, avatarLabel } from "./eventRow";

function baseMeeting(overrides: Partial<AgendaMeeting> = {}): AgendaMeeting {
	return {
		id: "1",
		title: "Weekly Sync",
		start: new Date("2026-01-01T10:00:00Z"),
		end: new Date("2026-01-01T10:30:00Z"),
		meetingUrl: null,
		location: "",
		htmlLink: "",
		attendees: [],
		invitees: [],
		organizer: null,
		organizerEmail: null,
		organizerIsSelf: false,
		iCalUID: null,
		recurringEventId: null,
		oneOnOnePartner: null,
		oneOnOnePartnerEmail: null,
		note: null,
		recording: null,
		status: null,
		...overrides,
	};
}

describe("avatarLabel", () => {
	it("prefers the 1:1 partner over the organizer and title", () => {
		const meeting = baseMeeting({
			oneOnOnePartner: "Bob",
			organizer: "Alice",
			title: "1:1 Bob <> Alice",
		});
		expect(avatarLabel(meeting)).toBe("Bob");
	});

	it("falls back to the organizer when there's no 1:1 partner", () => {
		const meeting = baseMeeting({ organizer: "Alice", title: "Standup" });
		expect(avatarLabel(meeting)).toBe("Alice");
	});

	it("falls back to the title when neither partner nor organizer is known", () => {
		const meeting = baseMeeting({ title: "Ad-hoc meeting" });
		expect(avatarLabel(meeting)).toBe("Ad-hoc meeting");
	});
});

describe("avatarInitial", () => {
	it("uppercases the first letter of the avatar label", () => {
		expect(avatarInitial(baseMeeting({ oneOnOnePartner: "bob" }))).toBe("B");
		expect(avatarInitial(baseMeeting({ organizer: "alice" }))).toBe("A");
		expect(avatarInitial(baseMeeting({ title: "weekly sync" }))).toBe("W");
	});

	it("trims surrounding whitespace before taking the first letter", () => {
		expect(avatarInitial(baseMeeting({ organizer: "  Alice" }))).toBe("A");
	});

	it("falls back to '?' for a blank label", () => {
		expect(avatarInitial(baseMeeting({ title: "   " }))).toBe("?");
	});
});
