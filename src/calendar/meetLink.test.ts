import { describe, it, expect } from "vitest";
import { extractMeetLink } from "./meetLink";

describe("extractMeetLink", () => {
	it("prefers the top-level hangoutLink", () => {
		expect(extractMeetLink({ hangoutLink: "https://meet.google.com/abc-defg-hij" }))
			.toBe("https://meet.google.com/abc-defg-hij");
	});

	it("falls back to a video entry point in conferenceData", () => {
		expect(
			extractMeetLink({
				conferenceData: {
					entryPoints: [
						{ entryPointType: "phone", uri: "tel:+1-555" },
						{ entryPointType: "video", uri: "https://meet.google.com/xyz" },
					],
				},
			})
		).toBe("https://meet.google.com/xyz");
	});

	it("returns null when there is no conferencing info", () => {
		expect(extractMeetLink({})).toBeNull();
	});

	it("returns null when a video entry point has no uri", () => {
		expect(extractMeetLink({ conferenceData: { entryPoints: [{ entryPointType: "video" }] } })).toBeNull();
	});
});
