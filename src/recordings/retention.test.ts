import { describe, expect, it } from "vitest";
import { findExpiredRecordings, isAudioExt } from "./retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY; // arbitrary fixed "now"

describe("isAudioExt", () => {
	it("recognizes audio extensions case-insensitively", () => {
		expect(isAudioExt("wav")).toBe(true);
		expect(isAudioExt("M4A")).toBe(true);
		expect(isAudioExt("md")).toBe(false);
	});
});

describe("findExpiredRecordings", () => {
	const files = [
		{ path: "Meetings/a.wav", ext: "wav", mtime: NOW - 40 * DAY },
		{ path: "Meetings/recent.wav", ext: "wav", mtime: NOW - 5 * DAY },
		{ path: "recordings/old.m4a", ext: "m4a", mtime: NOW - 40 * DAY },
		{ path: "Notes/keep.md", ext: "md", mtime: NOW - 40 * DAY },
		{ path: "Other/song.wav", ext: "wav", mtime: NOW - 40 * DAY },
	];

	it("returns only old audio inside the configured folders", () => {
		const expired = findExpiredRecordings(files, {
			folders: ["Meetings", "recordings"],
			retentionDays: 30,
			now: NOW,
		});
		expect(expired.map((f) => f.path)).toEqual([
			"Meetings/a.wav",
			"recordings/old.m4a",
		]);
	});

	it("is disabled when retentionDays <= 0", () => {
		expect(
			findExpiredRecordings(files, {
				folders: ["Meetings"],
				retentionDays: 0,
				now: NOW,
			})
		).toEqual([]);
	});

	it("never sweeps when no valid folder scope is given", () => {
		expect(
			findExpiredRecordings(files, {
				folders: ["", "  "],
				retentionDays: 30,
				now: NOW,
			})
		).toEqual([]);
	});

	it("sweeps an exact extraPath outside the folder scope, but not its neighbors", () => {
		const expired = findExpiredRecordings(files, {
			folders: ["recordings"],
			retentionDays: 30,
			now: NOW,
			// "Other" also holds song.wav (old, unrelated); only the exact
			// owned path may become eligible, never the folder around it.
			extraPaths: new Set(["Meetings/a.wav"]),
		});
		expect(expired.map((f) => f.path)).toEqual([
			"Meetings/a.wav",
			"recordings/old.m4a",
		]);
	});

	it("applies age and protection to extraPaths too", () => {
		const expired = findExpiredRecordings(files, {
			folders: [],
			retentionDays: 30,
			now: NOW,
			extraPaths: new Set([
				"Meetings/recent.wav", // too young
				"Meetings/a.wav", // protected
				"Other/song.wav", // eligible
			]),
			protectedPaths: new Set(["Meetings/a.wav"]),
		});
		expect(expired.map((f) => f.path)).toEqual(["Other/song.wav"]);
	});

	it("never returns protected paths", () => {
		const expired = findExpiredRecordings(files, {
			folders: ["Meetings"],
			retentionDays: 30,
			now: NOW,
			protectedPaths: new Set(["Meetings/a.wav"]),
		});
		expect(expired).toEqual([]);
	});
});
