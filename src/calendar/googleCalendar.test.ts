import { describe, it, expect, vi } from "vitest";
import { isDeclinedByUser, collectPages } from "./googleCalendar";

describe("isDeclinedByUser", () => {
	it("is true only when the self attendee declined", () => {
		expect(
			isDeclinedByUser([{ self: true, responseStatus: "declined" }])
		).toBe(true);
	});

	it("keeps events the user accepted, is tentative on, or hasn't answered", () => {
		expect(
			isDeclinedByUser([{ self: true, responseStatus: "accepted" }])
		).toBe(false);
		expect(
			isDeclinedByUser([{ self: true, responseStatus: "tentative" }])
		).toBe(false);
		expect(
			isDeclinedByUser([{ self: true, responseStatus: "needsAction" }])
		).toBe(false);
	});

	it("ignores other attendees' declines", () => {
		expect(
			isDeclinedByUser([
				{ email: "other@x.com", responseStatus: "declined" },
				{ self: true, responseStatus: "accepted" },
			])
		).toBe(false);
	});

	it("handles missing attendees / responseStatus", () => {
		expect(isDeclinedByUser(undefined)).toBe(false);
		expect(isDeclinedByUser([])).toBe(false);
		expect(isDeclinedByUser([{ self: true }])).toBe(false);
	});
});

describe("collectPages", () => {
	it("returns a single page when there is no nextPageToken", async () => {
		const fetchPage = vi.fn().mockResolvedValue({ items: [1, 2, 3] });
		const all = await collectPages<number>(fetchPage);
		expect(all).toEqual([1, 2, 3]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(fetchPage).toHaveBeenCalledWith(undefined);
	});

	it("follows nextPageToken and concatenates every page in order", async () => {
		const pages = [
			{ items: [1, 2], nextPageToken: "a" },
			{ items: [3, 4], nextPageToken: "b" },
			{ items: [5] },
		];
		let i = 0;
		const seenTokens: (string | undefined)[] = [];
		const all = await collectPages<number>(async (token) => {
			seenTokens.push(token);
			return pages[i++] ?? {};
		});
		expect(all).toEqual([1, 2, 3, 4, 5]);
		expect(seenTokens).toEqual([undefined, "a", "b"]);
	});

	it("stops at maxPages to guard against a looping token, and warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchPage = vi
			.fn()
			.mockResolvedValue({ items: [0], nextPageToken: "loops-forever" });
		const all = await collectPages<number>(fetchPage, 3);
		expect(all).toHaveLength(3);
		expect(fetchPage).toHaveBeenCalledTimes(3);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("treats an empty-string token as the end", async () => {
		const fetchPage = vi
			.fn()
			.mockResolvedValue({ items: [1], nextPageToken: "" });
		const all = await collectPages<number>(fetchPage);
		expect(all).toEqual([1]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});
});
