import { describe, it, expect } from "vitest";
import { avatarEmailFor } from "./agendaModel";

describe("avatarEmailFor", () => {
	it("prefers the 1:1 partner over the organizer", () => {
		expect(
			avatarEmailFor({
				oneOnOnePartnerEmail: "bob@example.com",
				organizerEmail: "me@example.com",
				organizerIsSelf: true,
			})
		).toBe("bob@example.com");
	});

	it("falls back to the organizer for a group meeting", () => {
		expect(
			avatarEmailFor({
				oneOnOnePartnerEmail: null,
				organizerEmail: "alice@example.com",
				organizerIsSelf: false,
			})
		).toBe("alice@example.com");
	});

	it("returns null for a self-organized group meeting (no partner, no one else to show)", () => {
		expect(
			avatarEmailFor({
				oneOnOnePartnerEmail: null,
				organizerEmail: "me@example.com",
				organizerIsSelf: true,
			})
		).toBeNull();
	});

	it("returns null when neither a partner nor a non-self organizer is available", () => {
		expect(
			avatarEmailFor({
				oneOnOnePartnerEmail: null,
				organizerEmail: null,
				organizerIsSelf: false,
			})
		).toBeNull();
	});
});
