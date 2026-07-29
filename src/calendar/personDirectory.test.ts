import { describe, it, expect, vi } from "vitest";
import {
	PersonNameCache,
	resolveAttendeeLabel,
	type PersonDirectory,
} from "./personDirectory";

describe("resolveAttendeeLabel", () => {
	it("prefers Calendar displayName over directory", async () => {
		const resolveDisplayName = vi.fn(async () => "Directory Name");
		const people: PersonDirectory = { resolveDisplayName };
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", "Nicolas Ruflin", people)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).not.toHaveBeenCalled();
	});

	it("uses People directory when Calendar has no displayName", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => "Nicolas Ruflin",
		};
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people)
		).resolves.toBe("Nicolas Ruflin");
	});

	it("falls back to humanized local-part when directory misses", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => null,
		};
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", "", people)
		).resolves.toBe("Ruflin");
	});

	it("caches directory hits and skips re-lookup", async () => {
		const resolveDisplayName = vi
			.fn()
			.mockResolvedValueOnce("Nicolas Ruflin");
		const people: PersonDirectory = { resolveDisplayName };
		const cache = new PersonNameCache();
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Nicolas Ruflin");
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).toHaveBeenCalledTimes(1);
	});

	it("soft-fails to humanized names when directory throws", async () => {
		const people: PersonDirectory = {
			resolveDisplayName: async () => {
				throw new Error("People API disabled");
			},
		};
		const cache = new PersonNameCache();
		await expect(
			resolveAttendeeLabel("ashutosh.kulkarni@elastic.co", "", people, cache)
		).resolves.toBe("Ashutosh Kulkarni");
		expect(cache.disabled).toBe(true);
		await expect(
			resolveAttendeeLabel("other@elastic.co", "", people, cache)
		).resolves.toBe("Other");
	});

	it("does not session-cache inconclusive (undefined) directory results", async () => {
		const resolveDisplayName = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce("Nicolas Ruflin");
		const people: PersonDirectory = { resolveDisplayName };
		const cache = new PersonNameCache();
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Ruflin");
		expect(cache.miss.has("ruflin@elastic.co")).toBe(false);
		await expect(
			resolveAttendeeLabel("ruflin@elastic.co", undefined, people, cache)
		).resolves.toBe("Nicolas Ruflin");
		expect(resolveDisplayName).toHaveBeenCalledTimes(2);
	});
});
