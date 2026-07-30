import { describe, it, expect } from "vitest";
import { avatarEmailFor } from "./agendaModel";

describe("avatarEmailFor", () => {
	it("prefers the 1:1 partner over the organizer", () => {
		expect(
			avatarEmailFor({
				oneOnOnePartnerEmail: "bob@example.com",
				organizerEmail: "me@example.com",
			})
		).toBe("bob@example.com");
	});

	it("falls back to the organizer for a group meeting", () => {
		expect(
			avatarEmailFor({
				oneOnOnePartnerEmail: null,
				organizerEmail: "alice@example.com",
			})
		).toBe("alice@example.com");
	});

	it("returns null when neither is available", () => {
		expect(
			avatarEmailFor({ oneOnOnePartnerEmail: null, organizerEmail: null })
		).toBeNull();
	});
});
