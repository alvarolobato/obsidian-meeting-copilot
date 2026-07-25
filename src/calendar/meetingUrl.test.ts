import { describe, it, expect } from "vitest";
import { extractMeetingUrlFromText } from "./meetingUrl";

describe("extractMeetingUrlFromText", () => {
	it("finds a Zoom join link in free text", () => {
		const text = "Dial in or join https://acme.zoom.us/j/123456789?pwd=abc see you";
		expect(extractMeetingUrlFromText(text)).toBe(
			"https://acme.zoom.us/j/123456789?pwd=abc"
		);
	});

	it("finds Zoom vanity / webinar / shared paths and zoomgov", () => {
		expect(
			extractMeetingUrlFromText("https://acme.zoom.us/my/alvaro.room")
		).toBe("https://acme.zoom.us/my/alvaro.room");
		expect(
			extractMeetingUrlFromText("Webinar: https://zoom.us/w/123456789")
		).toBe("https://zoom.us/w/123456789");
		expect(extractMeetingUrlFromText("https://zoom.us/s/987654321")).toBe(
			"https://zoom.us/s/987654321"
		);
		expect(
			extractMeetingUrlFromText(
				"Gov: https://acme.zoomgov.com/j/111222333?pwd=x"
			)
		).toBe("https://acme.zoomgov.com/j/111222333?pwd=x");
		expect(
			extractMeetingUrlFromText("https://evilzoom.us/j/123456789")
		).toBeNull();
	});

	it("finds a Google Meet link", () => {
		expect(
			extractMeetingUrlFromText("Meet: https://meet.google.com/abc-defg-hij")
		).toBe("https://meet.google.com/abc-defg-hij");
	});

	it("finds Teams meetup-join, personal live, and gov links", () => {
		const meetup =
			"https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=x";
		expect(extractMeetingUrlFromText(`Join here ${meetup}`)).toBe(meetup);
		expect(
			extractMeetingUrlFromText("https://teams.live.com/meet/1234567890abcdef")
		).toBe("https://teams.live.com/meet/1234567890abcdef");
		const gov =
			"https://teams.microsoft.us/l/meetup-join/19%3ameeting_gov/0?context=x";
		expect(extractMeetingUrlFromText(gov)).toBe(gov);
	});

	it("finds GoToMeeting, Whereby, and Chime meeting URLs", () => {
		expect(
			extractMeetingUrlFromText(
				"https://global.gotomeeting.com/join/123456789"
			)
		).toBe("https://global.gotomeeting.com/join/123456789");
		expect(
			extractMeetingUrlFromText("https://meet.goto.com/meet/abc-def")
		).toBe("https://meet.goto.com/meet/abc-def");
		expect(extractMeetingUrlFromText("https://whereby.com/standup-room")).toBe(
			"https://whereby.com/standup-room"
		);
		// Single-segment slug only — nested marketing paths aren't full matches
		// beyond the first segment (best-effort; still no bare domain).
		expect(extractMeetingUrlFromText("https://whereby.com/")).toBeNull();
		expect(
			extractMeetingUrlFromText(
				"https://chime.aws/meetings/abc-123-def"
			)
		).toBe("https://chime.aws/meetings/abc-123-def");
	});

	it("scans multiple fields in order", () => {
		expect(
			extractMeetingUrlFromText(
				"Conference Room B",
				"Notes: https://meet.google.com/xyz-mnop-qrs"
			)
		).toBe("https://meet.google.com/xyz-mnop-qrs");
	});

	it("returns null when no known provider link is present", () => {
		expect(
			extractMeetingUrlFromText("See the agenda at https://example.com/agenda")
		).toBeNull();
		expect(
			extractMeetingUrlFromText("Docs: https://chime.aws/docs/overview")
		).toBeNull();
		expect(extractMeetingUrlFromText(null, undefined, "")).toBeNull();
	});
});
